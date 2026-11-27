import { createAuditLogWriter } from "./audit-log";
import {
  bindingReleaseAvailability,
  bindingRequirementAvailability,
  OPEN_BINDING_REQUIREMENT_STATUSES_SQL,
  type BindingReleaseFacts,
} from "./binding-availability";
import { all, db, one, run, transaction } from "./db";
import { packageIdentity } from "./package-identity";
import { bindingFlowApprovalBlocker, canSubmitBindingFlow } from "./permissions";
import {
  canConfirmBindingNodeForProject,
  canManageProjectWorkflowForProject,
  canSubmitIntegrationConclusionForProject,
  canSubmitTransferForArea,
  versionProjectManagementBlocker,
} from "./access";
import { assert, DomainError } from "./domain-error";
import type { BatchConclusion } from "./constants";
import { integrationAttributionRules, integrationConclusionImpact, PARALLEL_RISK_TRIAL_ITEM_SQL } from "./integration-conclusion";
import { getActiveReleaseRequests, getFormalReleaseCheck, refreshTrialReadiness } from "./trial-readiness";
import {
  findReadyTrialProject,
  getRiskTrialEntries,
  getTrialNodeUsages,
  getTrialReleaseEligibility,
  missingTrialNodeAssignments,
  trialReleaseStateKey,
} from "./trial-eligibility";
import type { SessionUser } from "./types";
import { discardReportFile, reportArchivePath, resolveReportPath, writeReportFile } from "./report-storage";
import { releaseFlowUrl } from "./release-flow";
import {
  getActiveTransferProjects,
  getPreviousBatchVersions,
  insertTransferRequest,
  OPEN_BATCH_RESERVATION_SQL,
  OTHER_OPEN_BATCH_RESERVATION_SQL,
  PENDING_BATCH_REQUEST_SQL,
  refreshVersionAggregate,
  TRIAL_PENDING_VERSION_STATUSES_SQL,
} from "./transfer-requests";
import { getBatchSendCheck } from "./batch-send-check";
import { readTestReport } from "./test-report-validation";
import { getVersionForVoid, type ManualVersionVoidKind } from "./version-void";
import {
  ACTIVE_BINDING_FLOW_STATUSES_SQL,
  BINDING_BARCODE_FAILURE_REASON_LIMIT,
  bindingBarcodeEvidenceKey,
  bindingBarcodeProgress,
  isActiveBindingFlow,
  isBindingBarcodeResult,
  summarizeBindingBarcodes,
  type BindingBarcodeResult,
} from "./binding-barcode-results";

const audit = createAuditLogWriter(db);
const now = () => new Date().toISOString();

function projectForManagement(projectId: number): {
  id: number;
  name: string;
  status: string;
} {
  const project = one<{ id: number; name: string; status: string }>(
    "SELECT id, name, status FROM projects WHERE id = ?",
    projectId,
  );
  assert(project, "项目不存在。", "NOT_FOUND");
  return project;
}

function assertProjectManager(actor: SessionUser, projectId: number) {
  const project = projectForManagement(projectId);
  assert(project.status !== "ARCHIVED", "存档项目不能发起新的版本流程。");
  assert(
    canManageProjectWorkflowForProject(actor, project.id),
    "只有本项目软件经理或系统管理员可以组织项目版本流程。",
    "FORBIDDEN",
  );
  return project;
}

export function submitTransfer(
  actor: SessionUser,
  input: { packageId: number; version: string; changeSummary: string; archiveUrl: string; buildUrl: string; scopeProjectId?: number },
) {
  assert(input.version.trim().length > 0, "请填写版本号。");
  assert(input.changeSummary.trim().length >= 5, "请填写版本变更说明（至少 5 个字符）。");
  assert(/^https?:\/\//i.test(input.archiveUrl.trim()), "归档链接必须以 http:// 或 https:// 开头。");
  assert(/^https?:\/\//i.test(input.buildUrl.trim()), "构建地址必须以 http:// 或 https:// 开头。");

  return transaction(() => {
    const pkg = one<{ id: number; name: string; area_id: number | null; is_active: number }>(
      "SELECT id, name, area_id, is_active FROM packages WHERE id = ?",
      input.packageId,
    );
    assert(pkg, "软件包不存在。", "NOT_FOUND");
    assert(pkg.is_active === 1, "该软件包已停用，不能提交转测申请。");
    assert(canSubmitTransferForArea(actor, pkg.area_id), "只能提交所属责任田的软件包转测。", "FORBIDDEN");
    const duplicate = one<{ id: number }>(
      "SELECT id FROM package_versions WHERE package_id = ? AND LOWER(version) = LOWER(?)",
      input.packageId,
      input.version.trim(),
    );
    assert(!duplicate, "该版本号已存在，请填写新的版本号。");
    const projects = getActiveTransferProjects(db, input.packageId);
    assert(projects.length > 0, "该软件包尚未关联任何在行项目的测试节点，无法提交转测。");
    if (input.scopeProjectId !== undefined) {
      assert(projects.some((project) => project.id === input.scopeProjectId), "所选软件包不在当前项目的使用范围内。");
    }

    const timestamp = now();
    const result = run(
      `INSERT INTO package_versions
        (package_id, version, change_summary, archive_url, build_url, status, submitted_by, submitted_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'PENDING_TRANSFER', ?, ?, ?)`,
      input.packageId,
      input.version.trim(),
      input.changeSummary.trim(),
      input.archiveUrl.trim(),
      input.buildUrl.trim(),
      actor.id,
      timestamp,
      timestamp,
    );
    const versionId = Number(result.lastInsertRowid);
    for (const project of projects) {
      insertTransferRequest(db, versionId, project.id, timestamp);
    }
    audit(
      actor.id,
      "SUBMIT_TRANSFER",
      "PACKAGE",
      pkg.id,
      `提交 ${pkg.name} ${input.version.trim()} 转测申请，同步发送至 ${projects.length} 个项目`,
    );
    return { versionId, projectCount: projects.length };
  });
}

export function cancelTransfer(actor: SessionUser, versionId: number) {
  return transaction(() => {
    const version = one<{
      id: number;
      package_id: number;
      package_name: string;
      version: string;
      status: string;
      submitted_by: number | null;
    }>(
      `SELECT pv.id, pv.package_id, p.name AS package_name, pv.version, pv.status, pv.submitted_by
       FROM package_versions pv JOIN packages p ON p.id = pv.package_id WHERE pv.id = ?`,
      versionId,
    );
    assert(version, "转测申请不存在。", "NOT_FOUND");
    if (version.submitted_by !== actor.id) assertVersionProjectManager(actor, versionId);
    assert(version.status === "PENDING_TRANSFER", "该版本已进入测试或后续流程，不能撤回转测申请。");
    const started = one<{ count: number }>(
      "SELECT COUNT(*) AS count FROM version_transfer_requests WHERE package_version_id = ? AND status != 'PENDING'",
      versionId,
    );
    assert(Number(started?.count ?? 0) === 0, "该项目已有版本进入测试或后续流程，不能撤回整份申请。");
    const referenced = one<{ id: number }>(
      "SELECT id FROM batch_items WHERE package_version_id = ? LIMIT 1",
      versionId,
    );
    assert(!referenced, "该申请已被转测批次引用，请先处理对应批次。");
    run("DELETE FROM version_transfer_requests WHERE package_version_id = ?", versionId);
    run("DELETE FROM package_versions WHERE id = ?", versionId);
    audit(actor.id, "CANCEL_TRANSFER", "PACKAGE", version.package_id, `撤回 ${version.package_name} ${version.version} 转测申请`);
  });
}

export type CreateBatchInput = {
  projectId: number;
  code: string;
  title: string;
  draftBatchId?: number;
  expectedDraftRevision?: number;
  items: Array<{ packageId: number; packageVersionId: number; carryPrevious?: boolean }>;
};

export function createBatchDraft(actor: SessionUser, input: CreateBatchInput) {
  assertProjectManager(actor, input.projectId);
  const code = input.code.trim().toUpperCase();
  assert(/^B\d{3,}$/.test(code), "批次号格式应为 B 加至少 3 位数字，例如 B121。");
  const projectPackages = all<{ packageId: number; packageName: string; packageCode: string }>(
    `SELECT DISTINCT p.id AS packageId, p.name AS packageName, p.code AS packageCode
     FROM package_usages u JOIN packages p ON p.id = u.package_id
     WHERE u.project_id = ? AND p.is_active = 1
     ORDER BY p.name`,
    input.projectId,
  );
  assert(projectPackages.length > 0, "该项目尚未关联任何启用中的软件包，无法组织转测。");
  const selectedByPackage = new Map(input.items.map((item) => [item.packageId, item]));
  assert(selectedByPackage.size === input.items.length, "同一个软件包不能在批次中重复出现。");
  const selectedPackages = projectPackages.filter((pkg) => selectedByPackage.has(pkg.packageId));
  assert(selectedPackages.length > 0, "请至少选择一个软件包加入本次转测。");
  assert(selectedPackages.length === selectedByPackage.size, "只能选择本项目启用的在用软件包，请刷新页面后重试。");

  return transaction(() => {
    const project = assertProjectManager(actor, input.projectId);
    const draftId = input.draftBatchId ?? 0;
    if (input.draftBatchId !== undefined) {
      assert(Number.isSafeInteger(draftId) && draftId > 0, "批次参数无效。");
      const draft = one<{ code: string; status: string }>(
        "SELECT code, status FROM integration_batches WHERE id = ? AND project_id = ?", draftId, input.projectId,
      );
      assert(draft, "转测草稿不存在。", "NOT_FOUND");
      assert(draft.status === "DRAFT", "该批次已不是待发起状态，无法调整草稿。");
      assert(draft.code === code, "编辑配套时批次号不可更改。");
      const revision = one<{ revision: number }>("SELECT COALESCE(MAX(id), 0) AS revision FROM batch_items WHERE batch_id = ?", draftId);
      assert(input.expectedDraftRevision === revision?.revision, "此草稿已被其他操作更新。请刷新后核对最新配套，再保存调整。");
    }
    const existingCode = one<{ id: number }>("SELECT id FROM integration_batches WHERE UPPER(code) = ? AND id != ?", code, draftId);
    assert(!existingCode, `批次号 ${code} 已存在，请更换批次号。`);
    const previousByPackage = getPreviousBatchVersions(db, input.projectId, selectedPackages.map(({ packageId }) => packageId));
    const items = selectedPackages.map((pkg) => {
      const packageCode = packageIdentity({ name: pkg.packageName, code: pkg.packageCode }).code;
      const selection = selectedByPackage.get(pkg.packageId);
      assert(selection, `请选择 ${packageCode} 的转测版本。`);
      const selected = one<{
        id: number;
        version: string;
        status: string;
        archiveUrl: string;
        changeSummary: string;
      }>(
        `SELECT id, version, status, archive_url AS archiveUrl, change_summary AS changeSummary
         FROM package_versions WHERE id = ? AND package_id = ?`,
        selection.packageVersionId,
        pkg.packageId,
      );
      assert(selected, `${packageCode} 选择的版本不存在。`);
      assert(selected.status !== "VOID", `${packageCode} ${selected.version} 已作废，请更换该配套版本。`);
      const usedInProject = one<{ id: number }>(
        `SELECT u.id FROM package_usages u JOIN packages p ON p.id = u.package_id AND p.is_active = 1
         WHERE u.package_id = ? AND u.project_id = ? LIMIT 1`,
        pkg.packageId,
        input.projectId,
      );
      assert(usedInProject, `${packageCode} 不在 ${project.name} 项目的使用范围内。`);
      const previous = previousByPackage.get(pkg.packageId);
      if (selection.carryPrevious) {
        assert(
          previous?.canCarry && previous.versionId === selected.id,
          `${packageCode} 无法沿用所选的上次转测版本，请刷新后重试。`,
        );
      }
      const pendingRequest = selection.carryPrevious ? null : one<{ id: number; reserved: number }>(
        `SELECT r.id, ${OTHER_OPEN_BATCH_RESERVATION_SQL} AS reserved
         FROM version_transfer_requests r
         WHERE r.package_version_id = ? AND r.project_id = ? AND ${PENDING_BATCH_REQUEST_SQL}`,
        draftId,
        selected.id,
        input.projectId,
      );
      assert(!pendingRequest?.reserved, `${packageCode} ${selected.version} 已在另一个转测批次中。`);
      const formal = one<{ version: string }>(
        `SELECT pv.version FROM version_transfer_requests r JOIN package_versions pv ON pv.id = r.package_version_id
         WHERE r.project_id = ? AND pv.package_id = ? AND r.status = 'FORMAL'
         ORDER BY r.formal_released_at DESC, pv.id DESC LIMIT 1`,
        input.projectId,
        pkg.packageId,
      ) ?? one<{ version: string }>(
        `SELECT version FROM package_versions WHERE package_id = ? AND status = 'FORMAL' ORDER BY id DESC LIMIT 1`,
        pkg.packageId,
      );
      const trialVersions = all<{ version: string }>(
        `SELECT pv.version FROM version_transfer_requests r JOIN package_versions pv ON pv.id = r.package_version_id
         WHERE r.project_id = ? AND pv.package_id = ? AND r.status IN ('TRIAL','PENDING_FORMAL')
         ORDER BY r.trial_released_at DESC, pv.id DESC`,
        input.projectId,
        pkg.packageId,
      );
      return {
        packageId: pkg.packageId,
        packageCode,
        versionId: selected.id,
        version: selected.version,
        archiveUrl: selected.archiveUrl,
        changeSummary: selected.changeSummary,
        requestId: pendingRequest?.id ?? null,
        formalVersion: formal?.version ?? null,
        trialVersions: trialVersions.map((row) => row.version).join(", "),
        previousVersion: previous?.version ?? null,
        changedVsPrevious: previous?.version !== selected.version,
      };
    });
    const changedCount = items.filter((item) => item.requestId !== null).length;
    assert(changedCount > 0, "本次配套中没有选择待转测的新版本。请为有变更的软件包选择待转测版本。");

    const timestamp = now();
    const title = input.title.trim() || `${project.name} ${code} 整套转测`;
    const batchId = draftId || Number(run(
      `INSERT INTO integration_batches (code, project_id, title, status, created_by, created_at)
       VALUES (?, ?, ?, 'DRAFT', ?, ?)`,
      code, input.projectId, title, actor.id, timestamp,
    ).lastInsertRowid);
    const refreshVersions = new Set<number>();
    if (draftId) {
      for (const version of all<{ id: number }>(
        "SELECT DISTINCT package_version_id AS id FROM batch_items WHERE batch_id = ? AND transfer_request_id IS NOT NULL",
        draftId,
      )) refreshVersions.add(version.id);
      run("DELETE FROM batch_items WHERE batch_id = ?", batchId);
      run("UPDATE integration_batches SET title = ? WHERE id = ?", title, batchId);
    }
    for (const item of items) {
      if (item.requestId) {
        const available = one<{ id: number }>(
          `SELECT r.id FROM version_transfer_requests r WHERE r.id = ?
           AND ${PENDING_BATCH_REQUEST_SQL} AND NOT ${OPEN_BATCH_RESERVATION_SQL}`,
          item.requestId,
        );
        assert(available, `${item.packageCode} ${item.version} 的转测状态已变化，请刷新后重试。`);
      }
      run(
        `INSERT INTO batch_items
          (batch_id, package_id, package_version_id, version, archive_url, change_summary, is_changed,
           transfer_request_id, formal_version, trial_versions, previous_test_version, changed_vs_previous)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        batchId,
        item.packageId,
        item.versionId,
        item.version,
        item.archiveUrl,
        item.changeSummary,
        item.requestId ? 1 : 0,
        item.requestId,
        item.formalVersion,
        item.trialVersions,
        item.previousVersion,
        item.changedVsPrevious ? 1 : 0,
      );
      if (item.requestId) refreshVersions.add(item.versionId);
    }
    for (const versionId of refreshVersions) refreshTrialReadiness(db, versionId, timestamp);
    audit(actor.id, draftId ? "UPDATE_BATCH_DRAFT" : "CREATE_BATCH", "BATCH", batchId, `${draftId ? "调整" : "创建"} ${code}（${project.name}）转测草稿，${items.length} 个包，${changedCount} 个变更包`);
    return batchId;
  });
}

export function deleteDraftBatch(actor: SessionUser, batchId: number) {
  return transaction(() => {
    const batch = one<{ id: number; code: string; status: string; project_id: number }>(
      "SELECT id, code, status, project_id FROM integration_batches WHERE id = ?",
      batchId,
    );
    assert(batch, "转测批次不存在。", "NOT_FOUND");
    assertProjectManager(actor, batch.project_id);
    assert(batch.status === "DRAFT", "只有待发起的草稿批次可以删除。");
    const versionIds = all<{ id: number }>(
      "SELECT DISTINCT package_version_id AS id FROM batch_items WHERE batch_id = ? AND transfer_request_id IS NOT NULL",
      batchId,
    );
    run("DELETE FROM integration_batches WHERE id = ?", batchId);
    const timestamp = now();
    for (const version of versionIds) refreshTrialReadiness(db, version.id, timestamp);
    audit(actor.id, "DELETE_BATCH_DRAFT", "BATCH", batchId, `删除 ${batch.code} 转测草稿`);
  });
}

export function sendBatch(actor: SessionUser, batchId: number) {
  return transaction(() => {
    const batch = one<{ id: number; code: string; status: string; project_id: number; project_name: string }>(
      `SELECT b.id, b.code, b.status, b.project_id, p.name AS project_name
       FROM integration_batches b JOIN projects p ON p.id = b.project_id WHERE b.id = ?`,
      batchId,
    );
    assert(batch, "转测批次不存在。", "NOT_FOUND");
    assertProjectManager(actor, batch.project_id);
    assert(batch.status === "DRAFT", "该批次已不是待发起状态。");
    const { changes, blockers } = getBatchSendCheck(batchId);
    assert(blockers.length === 0, blockers[0]?.message ?? "请核对批次配套。");
    const timestamp = now();
    run("UPDATE integration_batches SET status = 'IN_TEST', sent_at = ? WHERE id = ?", timestamp, batchId);
    const versionIds = new Set<number>();
    for (const item of changes) {
      run(
        `UPDATE version_transfer_requests
         SET status = CASE WHEN status = 'PENDING' THEN 'IN_TEST' ELSE status END,
             integration_status = CASE WHEN integration_status IS NOT NULL THEN 'IN_TEST' END, updated_at = ?
         WHERE id = ?`,
        timestamp,
        item.transferRequestId,
      );
      versionIds.add(item.versionId);
    }
    for (const versionId of versionIds) {
      refreshVersionAggregate(db, versionId, timestamp);
      refreshTrialReadiness(db, versionId, timestamp);
    }
    audit(actor.id, "SEND_BATCH", "BATCH", batchId, `发起 ${batch.code}（${batch.project_name}）整套配套转测，${changes.length} 个变更包`);
    return batch.code;
  });
}

export function terminateBatch(actor: SessionUser, batchId: number, reason: string) {
  return transaction(() => {
    const batch = one<{ id: number; code: string; status: string; project_id: number }>(
      "SELECT id, code, status, project_id FROM integration_batches WHERE id = ?",
      batchId,
    );
    assert(batch, "转测批次不存在。", "NOT_FOUND");
    assertProjectManager(actor, batch.project_id);
    assert(batch.status === "IN_TEST", "只有集成测试中的批次可以终止。");
    assert(reason.trim().length >= 4, "请填写终止原因（至少 4 个字符）。");
    const requests = all<{ id: number; package_version_id: number }>(
      `SELECT r.id, r.package_version_id FROM batch_items bi
       JOIN version_transfer_requests r ON r.id = bi.transfer_request_id
       WHERE bi.batch_id = ?`,
      batchId,
    );
    const timestamp = now();
    run("UPDATE integration_batches SET status = 'TERMINATED', terminated_at = ?, terminate_reason = ? WHERE id = ?", timestamp, reason.trim(), batchId);
    for (const request of requests) {
      run(
        `UPDATE version_transfer_requests
         SET status = CASE WHEN status = 'IN_TEST' THEN 'PENDING' ELSE status END,
             integration_status = CASE WHEN integration_status IS NOT NULL THEN 'PENDING' END, updated_at = ?
          WHERE id = ? AND status != 'VOID'`,
        timestamp,
        request.id,
      );
      refreshVersionAggregate(db, request.package_version_id, timestamp);
      refreshTrialReadiness(db, request.package_version_id, timestamp);
    }
    run(
      "UPDATE trial_risk_admissions SET invalidated_at = ? WHERE batch_id = ? AND stage = 'IN_TEST' AND invalidated_at IS NULL",
      timestamp, batchId,
    );
    audit(actor.id, "TERMINATE_BATCH", "BATCH", batchId, `终止 ${batch.code} 集成测试：${reason.trim()}`);
  });
}

export function addBatchProgress(actor: SessionUser, batchId: number, content: string) {
  assert(content.trim().length >= 2, "请填写进展说明（至少 2 个字符）。");
  const batch = one<{ id: number; code: string; project_id: number; project_name: string; status: string }>(
    `SELECT b.id, b.code, b.project_id, p.name AS project_name, b.status
     FROM integration_batches b JOIN projects p ON p.id = b.project_id WHERE b.id = ?`,
    batchId,
  );
  assert(batch, "转测批次不存在。", "NOT_FOUND");
  assert(
    canSubmitIntegrationConclusionForProject(actor, batch.project_id),
    "只有本项目集成测试责任田负责人或系统管理员可以提交进展说明。",
    "FORBIDDEN",
  );
  transaction(() => {
    const timestamp = now();
    run(
      "INSERT INTO batch_progress_notes (batch_id, author_id, content, created_at) VALUES (?, ?, ?, ?)",
      batchId,
      actor.id,
      content.trim(),
      timestamp,
    );
    audit(actor.id, "ADD_BATCH_PROGRESS", "BATCH", batchId, `${batch.code} 提交集成测试进展说明：${content.trim().slice(0, 80)}`);
  });
}

export async function completeBatchTest(
  actor: SessionUser,
  batchId: number,
  input: {
    conclusion: BatchConclusion;
    issueAttribution: string;
    testSummary: string;
    reportFile: File | null;
    affectedVersionIds?: number[];
  },
) {
  const batch = one<{ id: number; code: string; status: string; project_id: number; project_name: string }>(
    `SELECT b.id, b.code, b.status, b.project_id, p.name AS project_name
     FROM integration_batches b JOIN projects p ON p.id = b.project_id WHERE b.id = ?`,
    batchId,
  );
  assert(batch, "转测批次不存在。", "NOT_FOUND");
  assert(
    canSubmitIntegrationConclusionForProject(actor, batch.project_id),
    "只有本项目集成测试责任田负责人或系统管理员可以提交测试结论。",
    "FORBIDDEN",
  );
  assert(batch.status === "IN_TEST", "只有集成测试中的批次可以提交测试结论。");
  assert(input.testSummary.trim().length >= 10, "请填写测试总结（至少 10 个字符）。");
  const { choices, errorMessage } = integrationAttributionRules[input.conclusion];
  assert(choices.some((choice) => choice === input.issueAttribution), errorMessage);
  assert(input.reportFile, "请上传验证报告。", "INVALID_TEST_REPORT");
  const file = input.reportFile;
  const report = readTestReport(file);
  assert(report.extension, report.error ?? "验证报告格式无效。", "INVALID_TEST_REPORT");
  const relativePath = reportArchivePath(batch, file.name, report.extension);
  const absolutePath = resolveReportPath(relativePath);
  assert(absolutePath, "验证报告归档路径无效。");
  const bytes = Buffer.from(await file.arrayBuffer());
  let reportWritten = false;
  try {
    return transaction(() => {
      const current = one<{ status: string }>("SELECT status FROM integration_batches WHERE id = ?", batchId);
      assert(current?.status === "IN_TEST", "该批次状态已变化，请刷新后重试。");
      const items = all<{
        version_id: number;
        version_status: string;
        request_id: number | null;
        parallelRiskTrial: number | null;
        package_name: string;
        version: string;
      }>(
        `SELECT bi.package_version_id AS version_id, pv.status AS version_status, bi.transfer_request_id AS request_id,
                ${PARALLEL_RISK_TRIAL_ITEM_SQL} AS parallelRiskTrial,
                p.name AS package_name, bi.version
         FROM batch_items bi JOIN package_versions pv ON pv.id = bi.package_version_id
         JOIN packages p ON p.id = bi.package_id WHERE bi.batch_id = ?`,
        batchId,
      );
      const impact = integrationConclusionImpact(input.conclusion, input.issueAttribution, items);
      const affected = new Set(impact.acceptsAffectedVersions ? input.affectedVersionIds : []);
      if (impact.requiresAffectedVersions) {
        assert(affected.size > 0, "请选择本次问题影响的软件包版本。");
      }
      assert([...affected].every((id) => items.some((item) => item.version_id === id)), "问题影响的软件包必须属于当前批次。");

      const timestamp = now();
      writeReportFile(absolutePath, bytes, batchId);
      reportWritten = true;
      const report = run(
        `INSERT INTO report_files (original_name, stored_path, mime_type, size_bytes, uploaded_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        file.name, relativePath, file.type || "application/octet-stream", file.size, actor.id, timestamp,
      );
      run(
        `UPDATE integration_batches SET status = 'COMPLETED', completed_at = ?, conclusion = ?,
                issue_attribution = ?, test_summary = ?, test_report_url = ?,
                test_report_file_id = ?, test_report_name = ? WHERE id = ?`,
        timestamp, input.conclusion, input.issueAttribution, input.testSummary.trim(),
        `/api/reports/${report.lastInsertRowid}`, report.lastInsertRowid, file.name, batchId,
      );
      const requestStatus = input.conclusion === "PASS" ? "PASSED" : input.conclusion === "FAIL" ? "FAILED" : "BLOCKED";
      let voidedCount = 0;
      for (const item of items) {
        if (affected.has(item.version_id)) {
          run("UPDATE batch_items SET issue_affected = 1 WHERE batch_id = ? AND package_version_id = ?", batchId, item.version_id);
          if (item.parallelRiskTrial) {
            const reason = `${batch.code} ${batch.project_name} 集成测试发现该软件包版本存在问题：${input.testSummary.trim()}`;
            voidParallelRiskTrial(actor, item, reason, timestamp);
            voidedCount++;
          }
        }
        if (item.request_id === null || item.version_status === "VOID") continue;
        run(
          `UPDATE version_transfer_requests
           SET status = CASE WHEN status = 'IN_TEST' THEN ? ELSE status END,
               integration_status = CASE WHEN integration_status IS NOT NULL THEN ? END, updated_at = ?
           WHERE id = ?`,
          requestStatus, requestStatus, timestamp, item.request_id,
        );
        if (requestStatus !== "PASSED") {
          run(
            `UPDATE trial_risk_admissions SET invalidated_at = ?
             WHERE package_version_id = ? AND invalidated_at IS NULL
               AND EXISTS (SELECT 1 FROM package_versions pv WHERE pv.id = package_version_id
                 AND pv.status IN ('PENDING_TRANSFER','IN_TEST','PENDING_TRIAL'))`,
            timestamp, item.version_id,
          );
        }
        refreshVersionAggregate(db, item.version_id, timestamp);
        refreshTrialReadiness(db, item.version_id, timestamp);
      }
      audit(actor.id, "COMPLETE_BATCH", "BATCH", batchId, `提交 ${batch.code} 测试结论：${input.conclusion}，上传报告 ${file.name}`);
      return { voidedCount };
    });
  } catch (error) {
    if (reportWritten) discardReportFile(absolutePath, batchId);
    throw error;
  }
}

function voidParallelRiskTrial(
  actor: SessionUser,
  item: { version_id: number; package_name: string; version: string },
  reason: string,
  timestamp: string,
) {
  voidVersionRecords(actor, item.version_id, "RISK_TEST_FAILURE", reason, timestamp);
  audit(actor.id, "VOID_RISK_TRIAL_TEST_FAILURE", "PACKAGE_VERSION", item.version_id, `作废 ${item.package_name} ${item.version} 风险试制。${reason}`);
}

type VersionVoidKind = "RISK_TEST_FAILURE" | ManualVersionVoidKind;

function voidVersionRecords(actor: SessionUser, versionId: number, kind: VersionVoidKind, reason: string, timestamp: string) {
  run(
    `UPDATE package_versions SET status = 'VOID', void_kind = ?, void_reason = ?,
       voided_at = ?, voided_by = ?, updated_at = ? WHERE id = ?`,
    kind, reason, timestamp, actor.id, timestamp, versionId,
  );
  run(
    `UPDATE version_transfer_requests SET status = 'VOID', void_reason = ?, voided_at = ?, updated_at = ?
     WHERE package_version_id = ?`,
    reason, timestamp, timestamp, versionId,
  );
  run(
    `UPDATE trial_risk_admissions SET invalidated_at = ?
     WHERE package_version_id = ? AND invalidated_at IS NULL`,
    timestamp, versionId,
  );
  run(
    `UPDATE binding_requirements SET status = 'CANCELLED', decision_reason = ?, updated_at = ?
     WHERE package_version_id = ? AND status IN ('PENDING','PASSED')`,
    reason, timestamp, versionId,
  );
}


export function admitRiskTrial(
  actor: SessionUser,
  input: { requestId: number; stage: string; batchId?: number; reason: string },
) {
  const reason = input.reason.trim();
  assert(reason.length >= 5 && reason.length <= 1000, "请填写 5 至 1000 字的风险试制原因。");
  return transaction(() => {
    const request = one<{ versionId: number; projectId: number }>(
      "SELECT package_version_id AS versionId, project_id AS projectId FROM version_transfer_requests WHERE id = ?",
      input.requestId,
    );
    assert(request, "项目版本记录不存在。", "NOT_FOUND");
    const project = assertProjectManager(actor, request.projectId);
    const entry = getRiskTrialEntries([input.requestId])[input.requestId];
    assert(entry && entry.stage === input.stage && entry.batchId === (input.batchId ?? null),
      "转测状态已变化，请刷新页面并按当前阶段登记风险原因。");
    assert(!entry.registered, "该版本已经登记风险试制原因，请查看待发布试制队列。");
    const candidate = getTrialReleaseEligibility(request.versionId);
    assert(candidate && candidate.riskProjectCount > 0 && candidate.projects.every((row) => row.usable)
      && candidate.projects.some((row) => row.requestId === input.requestId && row.projectId === project.id),
    "该版本已满足普通试制条件，或仍缺少共享试制所需的项目转测申请。");
    run(
      `INSERT INTO trial_risk_admissions
         (package_version_id, request_id, project_id, project_name, batch_id, stage, reason, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      request.versionId, input.requestId, project.id, project.name, entry.batchId, entry.stage, reason, actor.id, now(),
    );
    audit(actor.id, "ADMIT_RISK_TRIAL", "PACKAGE_VERSION", request.versionId, `${project.name}登记风险试制：${reason}`);
    return { projectId: project.id };
  });
}

export function releaseTrial(actor: SessionUser, requestId: number, trialFormNo: string, eligibility: string, reviewMinutes: string) {
  const trialUrl = releaseFlowUrl(trialFormNo);
  assert(trialUrl, "请输入有效的试制电子流网址（http 或 https）。");
  const minutes = reviewMinutes.trim();
  assert(minutes.length >= 1 && minutes.length <= 2000, "请输入试制评审纪要（1–2000 个字符）。");
  return transaction(() => {
    const anchor = one<{
      package_version_id: number;
      package_id: number;
      package_name: string;
      version: string;
      beforeTrial: number;
    }>(
      `SELECT r.package_version_id, p.id AS package_id, p.name AS package_name, pv.version,
              pv.status IN ${TRIAL_PENDING_VERSION_STATUSES_SQL} AS beforeTrial
       FROM version_transfer_requests r
       JOIN package_versions pv ON pv.id = r.package_version_id
       JOIN packages p ON p.id = pv.package_id
       WHERE r.id = ?`,
      requestId,
    );
    assert(anchor, "项目版本记录不存在。", "NOT_FOUND");
    assert(anchor.beforeTrial, "该版本已结束待发布流程，不能重复发布试制。");

    const ready = getTrialReleaseEligibility(anchor.package_version_id);
    const projects = ready?.projects ?? [];
    const requests = projects.flatMap((project) => project.requestId === null ? [] : [{ ...project, requestId: project.requestId }]);
    assert(requests.length > 0, "该版本没有可发布试制的项目记录。", "NOT_FOUND");
    assert(
      requests.some((request) => canManageProjectWorkflowForProject(actor, request.projectId)),
      "只有使用该软件包的项目软件经理或系统管理员可以发布试制。",
      "FORBIDDEN",
    );
    for (const project of projects) {
      assert(project.requestId !== null, `${project.projectName} 缺少该版本的转测申请，不能发布共享试制。`);
    }
    for (const request of requests) {
      assert(request.usable, `${request.projectName} 的版本状态不支持发布试制。`);
    }
    assert(ready?.releaseMode && findReadyTrialProject(ready, requestId), "请先在待转测申请或集成测试页面登记风险试制原因。");
    assert(trialReleaseStateKey(ready) === eligibility, "试制资格已变化，请刷新后重新确认。");
    const riskRequired = ready.releaseMode === "RISK";
    const riskConclusion = riskRequired ? ready.riskConclusion : null;

    const requirementsToCreate: Array<{
      requestId: number;
      projectId: number;
      nodeId: number;
      requiredCount: number;
      bindingOwnerId: number;
      bindingApproverId: number;
    }> = [];
    const usages = getTrialNodeUsages(anchor.package_id);
    const requestByProject = new Map(requests.map((request) => [request.projectId, request]));
    for (const request of requests) {
      assert(usages.some((usage) => usage.projectId === request.projectId), `${request.projectName} 没有该软件包的测试节点，无法发布试制。`);
    }
    for (const usage of usages) {
      const request = requestByProject.get(usage.projectId);
      assert(request, `${usage.projectName} 缺少该版本的转测申请，不能发布共享试制。`);
      const [missing] = missingTrialNodeAssignments(usage);
      assert(!missing, `${usage.projectName} / ${usage.nodeName} 未配置${missing}。`);
      requirementsToCreate.push({
        requestId: request.requestId,
        projectId: request.projectId,
        nodeId: usage.nodeId,
        requiredCount: Math.max(1, usage.requiredCount),
        bindingOwnerId: usage.bindingOwnerId!,
        bindingApproverId: usage.bindingApproverId!,
      });
    }

    const approverPools = new Map<number, number[]>();
    const configuredApprovers = all<{ nodeId: number; userId: number }>(
      `SELECT node_id AS nodeId, user_id AS userId FROM project_node_approvers
       WHERE node_id IN (SELECT value FROM json_each(?)) ORDER BY id`,
      JSON.stringify(requirementsToCreate.map(({ nodeId }) => nodeId)),
    );
    for (const { nodeId, userId } of configuredApprovers) {
      const pool = approverPools.get(nodeId);
      if (pool) pool.push(userId);
      else approverPools.set(nodeId, [userId]);
    }

    const timestamp = now();
    run(
      `UPDATE package_versions
       SET status = 'TRIAL', trial_form_no = ?, trial_review_minutes = ?, trial_released_at = ?, release_mode = ?,
           risk_conclusion = ?, binding_mode = 'PENDING', binding_reason = NULL,
           binding_decided_at = NULL, binding_decided_by = NULL, updated_at = ?
       WHERE id = ?`,
      trialUrl,
      minutes,
      timestamp,
      ready.releaseMode,
      riskConclusion ?? null,
      timestamp,
      anchor.package_version_id,
    );
    for (const request of requests) {
      run(
        `UPDATE version_transfer_requests
         SET integration_status = status, status = 'TRIAL', trial_form_no = ?, trial_released_at = ?, trial_released_by = ?,
             release_mode = ?, risk_conclusion = ?, updated_at = ?
         WHERE id = ?`,
        trialUrl,
        timestamp,
        actor.id,
        ready.releaseMode,
        riskConclusion ?? null,
        timestamp,
        request.requestId,
      );
    }
    for (const item of requirementsToCreate) {
      const insertResult = run(
        `INSERT INTO binding_requirements
          (request_id, package_version_id, project_id, node_id, required_count, binding_owner_id, approver_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
        item.requestId,
        anchor.package_version_id,
        item.projectId,
        item.nodeId,
        item.requiredCount,
        item.bindingOwnerId,
        item.bindingApproverId,
        timestamp,
        timestamp,
      );
      const requirementId = Number(insertResult.lastInsertRowid);
      for (const approverId of approverPools.get(item.nodeId) ?? [item.bindingApproverId]) {
        run(
          "INSERT OR IGNORE INTO binding_requirement_approvers (requirement_id, user_id, created_at) VALUES (?, ?, ?)",
          requirementId,
          approverId,
          timestamp,
        );
      }
    }
    refreshVersionAggregate(db, anchor.package_version_id, timestamp);
    audit(
      actor.id,
      "RELEASE_TRIAL",
      "PACKAGE",
      anchor.package_id,
      `按全项目共享发布 ${anchor.package_name} ${anchor.version} 试制版本，覆盖 ${requests.length} 个项目、${requirementsToCreate.length} 个节点绑定任务，电子流 ${trialUrl}${riskRequired ? "（风险发布）" : ""}`,
    );
    return requirementsToCreate.length;
  });
}

function assertVersionProjectManager(actor: SessionUser, versionId: number) {
  const blocker = versionProjectManagementBlocker(actor, versionId);
  assert(blocker !== "NO_PROJECT", "该版本没有可操作的项目记录。", "NOT_FOUND");
  assert(blocker !== "FORBIDDEN", "只有使用该软件包的项目软件经理或系统管理员可以执行该操作。", "FORBIDDEN");
}

export function pushBindingTasks(actor: SessionUser, requestId: number) {
  return transaction(() => {
    const anchor = one<{ package_version_id: number; status: string; binding_mode: string; package_name: string; version: string }>(
      `SELECT r.package_version_id, pv.status, pv.binding_mode, p.name AS package_name, pv.version
       FROM version_transfer_requests r
       JOIN package_versions pv ON pv.id = r.package_version_id
       JOIN packages p ON p.id = pv.package_id
       WHERE r.id = ?`,
      requestId,
    );
    assert(anchor, "项目版本记录不存在。", "NOT_FOUND");
    assertVersionProjectManager(actor, anchor.package_version_id);
    assert(anchor.status === "TRIAL", "只有试制验证中的版本可以推送绑定任务。");
    assert(anchor.binding_mode === "PENDING", "当前版本已完成绑定决策，不能重复推送。");
    const requirements = all<{ id: number }>(
      "SELECT id FROM binding_requirements WHERE package_version_id = ? AND status = 'PENDING'",
      anchor.package_version_id,
    );
    assert(requirements.length > 0, "该版本没有可推送的绑定任务。");
    const timestamp = now();
    run(
      "UPDATE binding_requirements SET pushed_at = ?, pushed_by = ?, updated_at = ? WHERE package_version_id = ? AND status = 'PENDING' AND pushed_at IS NULL",
      timestamp,
      actor.id,
      timestamp,
      anchor.package_version_id,
    );
    run(
      "UPDATE package_versions SET binding_mode = 'PUSHED', binding_reason = NULL, binding_decided_at = ?, binding_decided_by = ?, updated_at = ? WHERE id = ?",
      timestamp,
      actor.id,
      timestamp,
      anchor.package_version_id,
    );
    audit(actor.id, "PUSH_BINDING", "PACKAGE_VERSION", anchor.package_version_id, `推送 ${anchor.package_name} ${anchor.version} 绑定任务，共 ${requirements.length} 个节点`);
    return requirements.length;
  });
}

export function skipBindingAndEnterFormal(actor: SessionUser, requestId: number, reason: string) {
  assert(reason.trim().length >= 5, "请填写不进行绑定验证的原因。");
  return transaction(() => {
    const anchor = one<{ package_version_id: number; status: string; binding_mode: string; package_name: string; version: string }>(
      `SELECT r.package_version_id, pv.status, pv.binding_mode, p.name AS package_name, pv.version
       FROM version_transfer_requests r
       JOIN package_versions pv ON pv.id = r.package_version_id
       JOIN packages p ON p.id = pv.package_id
       WHERE r.id = ?`,
      requestId,
    );
    assert(anchor, "项目版本记录不存在。", "NOT_FOUND");
    assertVersionProjectManager(actor, anchor.package_version_id);
    assert(anchor.status === "TRIAL", "只有试制验证中的版本可以跳过绑定。");
    assert(anchor.binding_mode === "PENDING", "当前版本已完成绑定决策，不能重复操作。");
    const timestamp = now();
    run(
      "UPDATE binding_requirements SET status = 'CANCELLED', decision_reason = ?, updated_at = ? WHERE package_version_id = ? AND status = 'PENDING'",
      reason.trim(),
      timestamp,
      anchor.package_version_id,
    );
    run(
      "UPDATE package_versions SET binding_mode = 'SKIPPED', binding_reason = ?, binding_decided_at = ?, binding_decided_by = ?, updated_at = ? WHERE id = ?",
      reason.trim(),
      timestamp,
      actor.id,
      timestamp,
      anchor.package_version_id,
    );
    const enteredFormal = refreshTrialReadiness(db, anchor.package_version_id, timestamp);
    audit(actor.id, "SKIP_BINDING", "PACKAGE_VERSION", anchor.package_version_id, `跳过 ${anchor.package_name} ${anchor.version} 绑定验证：${reason.trim()}`);
    return { enteredFormal, versionId: anchor.package_version_id };
  });
}

export function waiveBindingRequirement(actor: SessionUser, requirementId: number, reason: string) {
  assert(reason.trim().length >= 5, "请填写此节点无需绑定的原因（至少 5 个字符）。");
  return transaction(() => {
    const requirement = one<BindingReleaseFacts & {
      request_id: number;
      package_version_id: number;
      project_id: number;
      node_name: string;
      status: string;
      binding_owner_id: number | null;
      pushed_at: string | null;
    }>(
      `SELECT br.request_id, br.package_version_id, br.project_id, n.name AS node_name,
              br.status, p.status AS projectStatus, r.status AS requestStatus,
              pv.status AS versionStatus, br.binding_owner_id, br.pushed_at
       FROM binding_requirements br
       JOIN version_transfer_requests r ON r.id = br.request_id
       JOIN projects p ON p.id = br.project_id
       JOIN package_versions pv ON pv.id = br.package_version_id
       JOIN project_nodes n ON n.id = br.node_id WHERE br.id = ?`,
      requirementId,
    );
    assert(requirement, "绑定任务不存在。", "NOT_FOUND");
    assert(
      canManageProjectWorkflowForProject(actor, requirement.project_id) || requirement.binding_owner_id === actor.id,
      "只有本项目软件经理、该节点绑定责任人或管理员可以登记无需绑定。",
      "FORBIDDEN",
    );
    const releaseAvailability = bindingReleaseAvailability(requirement);
    assert(releaseAvailability !== "ARCHIVED", "项目已归档，不能登记节点免绑。");
    assert(requirement.pushed_at, "请先确认并推送绑定任务，再处理节点绑定。");
    assert(requirement.requestStatus === "TRIAL" && requirement.status === "PENDING", "只有待绑定节点可以登记无需绑定。");
    assert(releaseAvailability === "OPEN", "该版本已结束绑定验证，不能登记节点免绑。");
    const timestamp = now();
    run(
      `UPDATE binding_requirements SET status = 'CANCELLED', decision_reason = ?, waived_at = ?, waived_by = ?, updated_at = ? WHERE id = ?`,
      reason.trim(), timestamp, actor.id, timestamp, requirementId,
    );
    run(
      `UPDATE binding_flows SET status = 'CANCELLED', cancelled_at = ?, cancel_reason = ?
       WHERE requirement_id = ? AND status = 'PENDING'`,
      timestamp, `该节点无需绑定：${reason.trim()}`, requirementId,
    );
    audit(actor.id, "WAIVE_BINDING_REQUIREMENT", "BINDING_REQUIREMENT", requirementId, `${requirement.node_name} 无需绑定：${reason.trim()}`);
    const enteredFormal = refreshTrialReadiness(db, requirement.package_version_id, timestamp);
    return { requestId: requirement.request_id, enteredFormal };
  });
}

export function abandonTrialRelease(actor: SessionUser, requestId: number, conclusion: string, eligibility: string) {
  assert(conclusion.trim().length >= 5, "请填写放弃发布试制的结论。");
  return transaction(() => {
    const anchor = one<{ package_version_id: number; package_name: string; version: string }>(
      `SELECT r.package_version_id, p.name AS package_name, pv.version
       FROM version_transfer_requests r
       JOIN package_versions pv ON pv.id = r.package_version_id
       JOIN packages p ON p.id = pv.package_id
       WHERE r.id = ?`,
      requestId,
    );
    assert(anchor, "项目版本记录不存在。", "NOT_FOUND");
    const ready = getTrialReleaseEligibility(anchor.package_version_id);
    const project = findReadyTrialProject(ready, requestId);
    assert(ready && project, "试制资格已变化，请刷新后重新确认。");
    assertProjectManager(actor, project.projectId);
    assert(trialReleaseStateKey(ready) === eligibility, "试制资格已变化，请刷新后重新确认。");
    const timestamp = now();
    if (ready.releaseMode === "RISK") {
      run("UPDATE trial_risk_admissions SET invalidated_at = ? WHERE package_version_id = ? AND invalidated_at IS NULL",
        timestamp, anchor.package_version_id);
      audit(actor.id, "WITHDRAW_RISK_TRIAL", "PACKAGE_VERSION", anchor.package_version_id, conclusion.trim());
      return { withdrawnRisk: true };
    }
    voidVersionRecords(actor, anchor.package_version_id, "ABANDON", `放弃发布试制：${conclusion.trim()}`, timestamp);
    audit(actor.id, "ABANDON_TRIAL_RELEASE", "PACKAGE_VERSION", anchor.package_version_id, `放弃发布 ${anchor.package_name} ${anchor.version} 试制：${conclusion.trim()}`);
    return { withdrawnRisk: false };
  });
}

export function voidPackageVersion(actor: SessionUser, versionId: number, reason: string, readyContext?: { requestId: number; eligibility: string }) {
  const trimmedReason = reason.trim();
  assert(trimmedReason.length >= 5, "请填写作废原因。");
  return transaction(() => {
    const version = getVersionForVoid(versionId);
    assert(version, "软件包版本不存在。", "NOT_FOUND");
    assertVersionProjectManager(actor, versionId);
    if (readyContext) {
      const ready = getTrialReleaseEligibility(versionId);
      const project = findReadyTrialProject(ready, readyContext.requestId);
      assert(
        ready && project && trialReleaseStateKey(ready) === readyContext.eligibility,
        "试制资格已变化，请刷新后重新确认。",
      );
      assertProjectManager(actor, project.projectId);
    }
    assert(version.kind, "当前版本状态不支持作废。");
    voidVersionRecords(actor, versionId, version.kind, trimmedReason, now());
    audit(actor.id, "VOID_VERSION", "PACKAGE_VERSION", versionId, `作废 ${version.packageName} ${version.version} 版本：${trimmedReason}`);
    return version.packageId;
  });
}

function invalidateBindingConfirmation(requirementId: number, versionId: number, timestamp: string) {
  run(
    `UPDATE binding_requirements SET status = 'PENDING', confirmed_at = NULL, confirmed_by = NULL, barcode_confirmation = 0, updated_at = ?
     WHERE id = ? AND status IN ${OPEN_BINDING_REQUIREMENT_STATUSES_SQL} AND waived_at IS NULL`,
    timestamp,
    requirementId,
  );
  refreshTrialReadiness(db, versionId, timestamp);
}

function bindingBarcodeEvidence(actor: SessionUser, requirementId: number, evidenceKey: string) {
  const requirement = one<BindingReleaseFacts & {
    request_id: number;
    version_id: number;
    project_id: number;
    project_name: string;
    node_name: string;
    package_name: string;
    version: string;
    package_owner_id: number | null;
    required_count: number;
    status: string;
    pushed_at: string | null;
    waived_at: string | null;
    barcode_revision: number;
  }>(
    `SELECT br.request_id, r.status AS requestStatus, pv.id AS version_id, pv.status AS versionStatus,
            pr.id AS project_id, pr.name AS project_name, pr.status AS projectStatus, n.name AS node_name,
            p.name AS package_name, p.owner_id AS package_owner_id, pv.version, br.required_count, br.status,
            br.pushed_at, br.waived_at, br.barcode_revision
     FROM binding_requirements br
     JOIN version_transfer_requests r ON r.id = br.request_id
     JOIN package_versions pv ON pv.id = br.package_version_id
     JOIN packages p ON p.id = pv.package_id
     JOIN projects pr ON pr.id = br.project_id
     JOIN project_nodes n ON n.id = br.node_id
     WHERE br.id = ?`,
    requirementId,
  );
  assert(requirement, "绑定任务不存在。", "NOT_FOUND");
  assert(
    canConfirmBindingNodeForProject(actor, requirement.package_owner_id, requirement.project_id),
    "只有软件包责任人、本项目软件经理或系统管理员可以判定条码或确认节点通过。",
    "FORBIDDEN",
  );
  const releaseAvailability = bindingReleaseAvailability(requirement);
  assert(releaseAvailability !== "ARCHIVED", "项目已归档，不能判定条码或确认节点通过。");
  assert(releaseAvailability === "OPEN", "该版本已结束绑定验证，不能判定条码或确认节点通过。");
  const nodeAvailability = bindingRequirementAvailability({
    status: requirement.status, pushed: Boolean(requirement.pushed_at), waived: Boolean(requirement.waived_at),
  });
  assert(nodeAvailability === "OPEN", "该节点未推送、已关闭或已免绑。");

  const flows = all<{ id: number; status: string }>(
    `SELECT id, status FROM binding_flows WHERE requirement_id = ? AND status IN ${ACTIVE_BINDING_FLOW_STATUSES_SQL}`,
    requirementId,
  );
  assert(bindingBarcodeEvidenceKey(requirement.barcode_revision, flows) === evidenceKey, "绑定电子流或条码判定已变化，请刷新后重新核对。");
  const barcodes = all<{
    id: number;
    flowId: number;
    flowStatus: "PENDING" | "APPROVED";
    barcode: string;
    result: BindingBarcodeResult;
    failureReason: string | null;
  }>(
    `SELECT b.id, f.id AS flowId, f.status AS flowStatus, b.barcode,
            b.validation_result AS result, b.failure_reason AS failureReason
     FROM binding_flow_barcodes b JOIN binding_flows f ON f.id = b.flow_id
     WHERE f.requirement_id = ? AND f.status IN ${ACTIVE_BINDING_FLOW_STATUSES_SQL} ORDER BY b.id`,
    requirementId,
  );
  return { requirement, barcodes };
}

function recordBindingBarcodeUpdate(requirementId: number, timestamp: string) {
  run("UPDATE binding_requirements SET barcode_revision = barcode_revision + 1, updated_at = ? WHERE id = ?", timestamp, requirementId);
}

export function saveBindingBarcodeResults(
  actor: SessionUser,
  requirementId: number,
  flowId: number,
  evidenceKey: string,
  results: ReadonlyMap<number, string>,
) {
  assert(results.size > 0, "请选择要保存的设备条码判定。");
  return transaction(() => {
    const { requirement, barcodes } = bindingBarcodeEvidence(actor, requirementId, evidenceKey);
    const flowBarcodes = barcodes.filter((barcode) => barcode.flowId === flowId);
    assert(flowBarcodes.length > 0, "该电子流或设备条码已变化，请刷新后重新核对。");
    assert(requirement.status === "PENDING" || flowBarcodes[0].flowStatus === "PENDING",
      "节点已确认，已审批电子流的条码判定已锁定。");
    const barcodeById = new Map(flowBarcodes.map((barcode) => [barcode.id, barcode]));
    const timestamp = now();
    let changed = false;
    for (const [barcodeId, result] of results) {
      const barcode = barcodeById.get(barcodeId);
      assert(barcode, "该电子流或设备条码已变化，请刷新后重新核对。");
      assert(isBindingBarcodeResult(result), "请选择有效的设备条码判定。");
      if (barcode.result === result) continue;
      run(
        `UPDATE binding_flow_barcodes
         SET validation_result = ?, validated_at = ?, validated_by = ?, failure_reason = NULL, failure_reason_at = NULL, failure_reason_by = NULL
         WHERE id = ?`,
        result, result === "UNREVIEWED" ? null : timestamp, result === "UNREVIEWED" ? null : actor.id, barcodeId,
      );
      audit(actor.id, "SET_BINDING_BARCODE_RESULT", "BINDING_FLOW_BARCODE", barcodeId,
        `设备条码 ${barcode.barcode}：${barcode.result} → ${result}${barcode.failureReason ? `。原失败原因：${barcode.failureReason}` : ""}`);
      changed = true;
    }
    if (changed) recordBindingBarcodeUpdate(requirementId, timestamp);
    return { requestId: requirement.request_id };
  });
}

export function confirmBindingRequirement(
  actor: SessionUser,
  requirementId: number,
  evidenceKey: string,
  failureReasons: ReadonlyMap<number, string>,
  saveReasonsOnly: boolean,
) {
  return transaction(() => {
    const { requirement, barcodes } = bindingBarcodeEvidence(actor, requirementId, evidenceKey);
    assert(requirement.status === "PENDING", "该节点已确认，请核对最新的绑定验证状态。");
    const failed = new Map(barcodes.filter((barcode) => barcode.result === "FAIL").map((barcode) => [barcode.id, barcode]));
    for (const [barcodeId, reason] of failureReasons) {
      const barcode = failed.get(barcodeId);
      assert(barcode, "待记录失败原因的设备条码已变化，请刷新后重新核对。");
      assert(reason.trim().length > 0 && reason.trim().length <= BINDING_BARCODE_FAILURE_REASON_LIMIT,
        `请填写设备条码 ${barcode.barcode} 的失败原因（不超过 ${BINDING_BARCODE_FAILURE_REASON_LIMIT} 字）。`);
    }
    for (const barcode of failed.values()) {
      assert((failureReasons.get(barcode.id) ?? barcode.failureReason)?.trim(), `请填写设备条码 ${barcode.barcode} 的失败原因。`);
    }

    const counts = summarizeBindingBarcodes(barcodes);
    if (!saveReasonsOnly) {
      const progress = bindingBarcodeProgress(requirement.required_count, counts);
      assert(counts.unreviewedApprovedCount === 0, "请先判定已审批电子流的全部设备条码。");
      assert(progress.canConfirm, "已审批且判定通过的有效条码数量尚未达标，不能确认节点通过。");
    }

    const timestamp = now();
    let changed = false;
    for (const barcode of failed.values()) {
      const reason = failureReasons.get(barcode.id)?.trim();
      if (!reason || reason === barcode.failureReason) continue;
      run(
        "UPDATE binding_flow_barcodes SET failure_reason = ?, failure_reason_at = ?, failure_reason_by = ? WHERE id = ?",
        reason, timestamp, actor.id, barcode.id,
      );
      audit(actor.id, "RECORD_BINDING_BARCODE_FAILURE", "BINDING_FLOW_BARCODE", barcode.id,
        `设备条码 ${barcode.barcode} 的失败原因：${reason}${barcode.failureReason ? `。原失败原因：${barcode.failureReason}` : ""}`);
      changed = true;
    }
    if (changed) recordBindingBarcodeUpdate(requirementId, timestamp);
    if (saveReasonsOnly) return { requestId: requirement.request_id, enteredFormal: false };

    run(
      `UPDATE binding_requirements
       SET status = 'PASSED', confirmed_at = ?, confirmed_by = ?, barcode_confirmation = 1, updated_at = ? WHERE id = ?`,
      timestamp, actor.id, timestamp, requirementId,
    );
    const enteredFormal = refreshTrialReadiness(db, requirement.version_id, timestamp);
    audit(actor.id, "CONFIRM_BINDING_REQUIREMENT", "BINDING_REQUIREMENT", requirementId,
      `确认 ${requirement.package_name} ${requirement.version} 在 ${requirement.project_name}/${requirement.node_name} 的绑定验证通过，已审批且判定通过的条码 ${counts.passedBarcodeCount} 个，已记录失败原因 ${failed.size} 个`);
    return { requestId: requirement.request_id, enteredFormal };
  });
}

export function submitBindingFlow(actor: SessionUser, requirementId: number, barcodes: string[], approverId: number, webUrl: string) {
  const normalizedBarcodes = [...new Set(barcodes.map((barcode) => barcode.trim()).filter(Boolean))];
  assert(normalizedBarcodes.length > 0, "请至少添加一个设备条码。");
  assert(/^https?:\/\//i.test(webUrl.trim()), "请填写有效的网页电子流地址（http/https）。");
  for (const barcode of normalizedBarcodes) {
    assert(barcode.length >= 3 && barcode.length <= 80, "设备条码长度需为 3-80 个字符。");
  }
  return transaction(() => {
    const requirement = one<BindingReleaseFacts & {
      id: number;
      request_id: number;
      status: string;
      package_version_id: number;
      package_id: number;
      package_name: string;
      version: string;
      binding_owner_id: number | null;
      approver_id: number | null;
      project_id: number;
      project_name: string;
      node_id: number;
      node_name: string;
      pushed_at: string | null;
      waived_at: string | null;
    }>(
      `SELECT br.id, br.request_id, r.status AS requestStatus, pv.status AS versionStatus, br.status, br.package_version_id, p.id AS package_id,
              p.name AS package_name, pv.version, br.binding_owner_id, br.approver_id, br.project_id,
              pr.name AS project_name, pr.status AS projectStatus, br.node_id, n.name AS node_name, br.pushed_at, br.waived_at
       FROM binding_requirements br
       JOIN version_transfer_requests r ON r.id = br.request_id
       JOIN package_versions pv ON pv.id = br.package_version_id
       JOIN packages p ON p.id = pv.package_id
       JOIN projects pr ON pr.id = br.project_id
       JOIN project_nodes n ON n.id = br.node_id
       WHERE br.id = ?`,
      requirementId,
    );
    assert(requirement, "绑定任务不存在。", "NOT_FOUND");
    assert(
      canSubmitBindingFlow(actor, requirement.binding_owner_id),
      "只有该节点的绑定验证责任人或系统管理员可以提交绑定电子流。",
      "FORBIDDEN",
    );
    const releaseAvailability = bindingReleaseAvailability(requirement);
    assert(releaseAvailability !== "ARCHIVED", "项目已归档，不能提交绑定电子流。");
    assert(releaseAvailability === "OPEN", "该版本已结束绑定验证，不能提交绑定电子流。");
    const nodeAvailability = bindingRequirementAvailability({
      status: requirement.status, pushed: Boolean(requirement.pushed_at), waived: Boolean(requirement.waived_at),
    });
    assert(nodeAvailability !== "CLOSED", "该节点已关闭或已免绑，不能提交绑定电子流。");
    assert(nodeAvailability === "OPEN", "软件经理尚未推送绑定任务，暂不能提交绑定电子流。");
    const approvers = all<{ userId: number }>(
      "SELECT user_id AS userId FROM binding_requirement_approvers WHERE requirement_id = ? ORDER BY id",
      requirementId,
    );
    const approverPool = approvers.length > 0
      ? approvers.map((row) => row.userId)
      : requirement.approver_id ? [requirement.approver_id] : [];
    assert(approverPool.length > 0, "该节点未配置绑定电子流审批人范围。");
    assert(approverPool.includes(approverId), "请选择该节点审批人范围内的审批人。");
    assert(approverId !== actor.id, "绑定电子流审批人不能与提交人相同。");
    const selectedApprover = one<{ id: number; name: string }>("SELECT id, name FROM users WHERE id = ? AND is_active = 1", approverId);
    assert(selectedApprover, "选择的审批人不存在或已停用。");
    for (const barcode of normalizedBarcodes) {
      const duplicate = one<{ id: number }>(
        `SELECT f.id FROM binding_flow_barcodes b JOIN binding_flows f ON f.id = b.flow_id
         WHERE f.requirement_id = ? AND b.barcode = ? AND f.status IN ${ACTIVE_BINDING_FLOW_STATUSES_SQL} LIMIT 1`,
        requirementId,
        barcode,
      );
      assert(!duplicate, `设备条码 ${barcode} 已提交过绑定电子流。`);
    }
    const timestamp = now();
    const result = run(
      `INSERT INTO binding_flows
        (flow_no, requirement_id, package_version_id, project_id, node_id, device_barcode,
         submitted_by, approver_id, status, submitted_at, web_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
      `TEMP-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      requirementId,
      requirement.package_version_id,
      requirement.project_id,
      requirement.node_id,
      normalizedBarcodes.join(", "),
      actor.id,
      approverId,
      timestamp,
      webUrl.trim(),
    );
    const flowId = Number(result.lastInsertRowid);
    const flowNo = `BF-${new Date().getFullYear()}-${String(flowId).padStart(4, "0")}`;
    run("UPDATE binding_flows SET flow_no = ? WHERE id = ?", flowNo, flowId);
    for (const barcode of normalizedBarcodes) {
      run("INSERT INTO binding_flow_barcodes (flow_id, barcode, created_at) VALUES (?, ?, ?)", flowId, barcode, timestamp);
    }
    audit(actor.id, "SUBMIT_BINDING_FLOW", "BINDING_FLOW", flowId, `提交 ${requirement.package_name} ${requirement.version} 在 ${requirement.project_name}/${requirement.node_name} 的绑定电子流，审批人 ${selectedApprover.name}，条码：${normalizedBarcodes.join("、")}`);
    return { flowId, flowNo, requestId: requirement.request_id, approverName: selectedApprover.name };
  });
}

export function cancelBindingFlow(actor: SessionUser, flowId: number, reason: string) {
  const notes = reason.trim();
  assert(notes.length >= 5 && notes.length <= 2000, "请填写撤销原因（5–2000 个字符）。");
  return transaction(() => {
    const flow = one<BindingReleaseFacts & {
      submitted_by: number | null;
      status: string;
      project_id: number;
      version_id: number;
      request_id: number;
      requirement_id: number;
    }>(
      `SELECT f.submitted_by, f.status, f.project_id, pr.status AS projectStatus, pv.id AS version_id,
              pv.status AS versionStatus, br.request_id, r.status AS requestStatus, f.requirement_id
       FROM binding_flows f
       JOIN binding_requirements br ON br.id = f.requirement_id
       JOIN version_transfer_requests r ON r.id = br.request_id
       JOIN package_versions pv ON pv.id = f.package_version_id
       JOIN projects pr ON pr.id = f.project_id
       WHERE f.id = ?`,
      flowId,
    );
    assert(flow, "绑定电子流不存在。", "NOT_FOUND");
    assert(
      flow.submitted_by === actor.id || canManageProjectWorkflowForProject(actor, flow.project_id),
      "只有提交人、本项目软件经理或管理员可以撤销绑定电子流。",
      "FORBIDDEN",
    );
    assert(isActiveBindingFlow(flow.status), "该绑定电子流已结束，无需撤销。");
    const beforeFormal = bindingReleaseAvailability(flow) === "OPEN";
    assert(beforeFormal || flow.versionStatus === "VOID", "仅未转正或已作废的版本允许撤销绑定电子流。");
    const timestamp = now();
    run(
      "UPDATE binding_flows SET status = 'CANCELLED', cancelled_at = ?, cancel_reason = ? WHERE id = ?",
      timestamp,
      notes,
      flowId,
    );
    let returnedToBinding = false;
    if (beforeFormal && flow.status === "APPROVED") {
      invalidateBindingConfirmation(flow.requirement_id, flow.version_id, timestamp);
      returnedToBinding = flow.versionStatus === "PENDING_FORMAL"
        && one<{ status: string }>("SELECT status FROM package_versions WHERE id = ?", flow.version_id)?.status === "TRIAL";
    }
    audit(actor.id, "CANCEL_BINDING_FLOW", "BINDING_FLOW", flowId, `撤销绑定电子流：${notes}`);
    return { requestId: flow.request_id, requirementId: flow.requirement_id, returnedToBinding };
  });
}

export function decideBindingFlow(
  actor: SessionUser,
  flowId: number,
  decision: "APPROVED" | "REJECTED",
  comment: string,
) {
  assert(comment.trim().length >= 2, "请填写审批意见。");
  return transaction(() => {
    const flow = one<BindingReleaseFacts & {
      id: number;
      submittedById: number | null;
      approverId: number | null;
      status: string;
      requirement_id: number;
      request_id: number;
      requirement_status: string;
      pushed_at: string | null;
      waived_at: string | null;
      version_id: number;
      package_id: number;
      package_name: string;
      version: string;
      project_name: string;
      node_name: string;
    }>(
      `SELECT f.id, f.submitted_by AS submittedById, f.approver_id AS approverId, f.status, f.requirement_id, br.request_id,
              r.status AS requestStatus, br.status AS requirement_status, br.pushed_at, br.waived_at,
              f.package_version_id AS version_id, pv.status AS versionStatus, pr.status AS projectStatus, p.id AS package_id,
              p.name AS package_name, pv.version, pr.name AS project_name, n.name AS node_name
       FROM binding_flows f
       JOIN binding_requirements br ON br.id = f.requirement_id
       JOIN version_transfer_requests r ON r.id = br.request_id
       JOIN package_versions pv ON pv.id = f.package_version_id
       JOIN packages p ON p.id = pv.package_id
       JOIN projects pr ON pr.id = f.project_id
       JOIN project_nodes n ON n.id = f.node_id
       WHERE f.id = ?`,
      flowId,
    );
    assert(flow, "绑定电子流不存在。", "NOT_FOUND");
    const approvalBlocker = bindingFlowApprovalBlocker(actor, flow);
    assert(approvalBlocker !== "FORBIDDEN", "只有该节点的绑定电子流审批人或管理员可以审批。", "FORBIDDEN");
    assert(approvalBlocker !== "SELF_REVIEW", "不能审批自己提交的绑定电子流。");
    assert(flow.status === "PENDING", "该绑定电子流已处理。");
    const releaseAvailability = bindingReleaseAvailability(flow);
    assert(releaseAvailability !== "ARCHIVED", "项目已归档，不能审批绑定电子流。");
    assert(releaseAvailability === "OPEN", "该版本已作废或已发布正式版本，不能审批绑定电子流。");
    const nodeAvailability = bindingRequirementAvailability({
      status: flow.requirement_status, pushed: Boolean(flow.pushed_at), waived: Boolean(flow.waived_at),
    });
    assert(nodeAvailability === "OPEN", "该节点未推送、已关闭或已免绑，不能审批绑定电子流。");
    const timestamp = now();
    run(
      "UPDATE binding_flows SET status = ?, reviewed_at = ?, reviewed_by = ?, review_comment = ? WHERE id = ?",
      decision,
      timestamp,
      actor.id,
      comment.trim(),
      flowId,
    );
    if (decision === "APPROVED") invalidateBindingConfirmation(flow.requirement_id, flow.version_id, timestamp);
    audit(
      actor.id,
      decision === "APPROVED" ? "APPROVE_BINDING_FLOW" : "REJECT_BINDING_FLOW",
      "BINDING_FLOW",
      flowId,
      `${decision === "APPROVED" ? "通过" : "驳回"} ${flow.package_name} ${flow.version} 在 ${flow.project_name}/${flow.node_name} 的绑定电子流：${comment.trim()}`,
    );
    return { requestId: flow.request_id, requirementId: flow.requirement_id };
  });
}

export function releaseFormal(actor: SessionUser, requestId: number, flowNo: string, reviewMinutes: string) {
  const formalUrl = releaseFlowUrl(flowNo);
  assert(formalUrl, "请输入有效的转正电子流网址（http 或 https）。");
  const minutes = reviewMinutes.trim();
  assert(minutes.length >= 1 && minutes.length <= 2000, "请输入转正评审纪要（1–2000 个字符）。");
  return transaction(() => {
    const anchor = one<{
      id: number;
      package_version_id: number;
      package_id: number;
      package_name: string;
      version: string;
      binding_mode: string;
      version_status: string;
    }>(
      `SELECT r.id, r.package_version_id, p.id AS package_id, p.name AS package_name, pv.version, pv.binding_mode,
              pv.status AS version_status
       FROM version_transfer_requests r
       JOIN package_versions pv ON pv.id = r.package_version_id
       JOIN packages p ON p.id = pv.package_id
       WHERE r.id = ?`,
      requestId,
    );
    assert(anchor, "项目版本记录不存在。", "NOT_FOUND");
    const requests = getActiveReleaseRequests(db, anchor.package_version_id);
    assert(requests.some((request) => request.id === requestId), "该项目没有可转正的试制记录。", "NOT_FOUND");
    assert(
      requests.some((request) => canManageProjectWorkflowForProject(actor, request.projectId)),
      "只有使用该软件包的项目软件经理或系统管理员可以发布转正。",
      "FORBIDDEN",
    );
    const { blocker } = getFormalReleaseCheck(db, {
      id: anchor.package_version_id, status: anchor.version_status, bindingMode: anchor.binding_mode,
    }, requests);
    if (blocker !== null) throw new DomainError(blocker);
    const timestamp = now();
    run(
      `UPDATE package_versions SET status = 'FORMAL', formal_released_at = ?, form_flow_no = ?, formal_review_minutes = ?, updated_at = ? WHERE id = ?`,
      timestamp,
      formalUrl,
      minutes,
      timestamp,
      anchor.package_version_id,
    );
    for (const request of requests) {
      run(
        `UPDATE version_transfer_requests
         SET status = 'FORMAL', formal_released_at = ?, formal_released_by = ?, form_flow_no = ?, updated_at = ?
         WHERE id = ?`,
        timestamp,
        actor.id,
        formalUrl,
        timestamp,
        request.id,
      );
    }
    refreshVersionAggregate(db, anchor.package_version_id, timestamp);
    audit(
      actor.id,
      "RELEASE_FORMAL",
      "PACKAGE",
      anchor.package_id,
      `${anchor.package_name} ${anchor.version} 全项目绑定完成，按共享版本发布正式版本，覆盖 ${requests.length} 个项目，转正电子流：${formalUrl}`,
    );
    return anchor.package_version_id;
  });
}
