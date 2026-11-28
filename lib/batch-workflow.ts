import "server-only";

import { assertProjectManager, canSubmitIntegrationConclusionForProject } from "./access";
import { createAuditLogWriter } from "./audit-log";
import { getBatchSendCheck } from "./batch-send-check";
import type { BatchConclusion } from "./constants";
import { all, db, one, run, transaction } from "./db";
import { assert } from "./domain-error";
import { integrationAttributionRules, integrationConclusionImpact, PARALLEL_RISK_TRIAL_ITEM_SQL } from "./integration-conclusion";
import { packageIdentity } from "./package-identity";
import { discardReportFile, reportArchivePath, resolveReportPath, writeReportFile } from "./report-storage";
import { readTestReport } from "./test-report-validation";
import {
  getPreviousBatchVersions,
  OPEN_BATCH_RESERVATION_SQL,
  OTHER_OPEN_BATCH_RESERVATION_SQL,
  PENDING_BATCH_REQUEST_SQL,
  refreshVersionAggregate,
} from "./transfer-requests";
import { refreshTrialReadiness } from "./trial-readiness";
import { invalidateInTestRiskAdmissionsForBatch, invalidateUnreleasedRiskTrialAdmission } from "./trial-risk-admissions";
import type { SessionUser } from "./types";
import { voidVersionRecords } from "./version-void-workflow";
import { storedTestReportHref } from "./workflow-links";

const audit = createAuditLogWriter(db);
const now = () => new Date().toISOString();

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
    invalidateInTestRiskAdmissionsForBatch(db, batchId, timestamp);
    audit(actor.id, "TERMINATE_BATCH", "BATCH", batchId, `终止 ${batch.code} 集成测试：${reason.trim()}`);
  });
}

export function addBatchProgress(actor: SessionUser, batchId: number, content: string) {
  assert(content.trim().length >= 2, "请填写进展说明（至少 2 个字符）。");
  transaction(() => {
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

function assertBatchConclusionDuty(actor: SessionUser, projectId: number) {
  assert(
    canSubmitIntegrationConclusionForProject(actor, projectId),
    "只有本项目集成测试责任田负责人或系统管理员可以提交测试结论。",
    "FORBIDDEN",
  );
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
  assertBatchConclusionDuty(actor, batch.project_id);
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
      const current = one<{ status: string; project_id: number }>(
        "SELECT status, project_id FROM integration_batches WHERE id = ?",
        batchId,
      );
      assert(current?.status === "IN_TEST", "该批次状态已变化，请刷新后重试。");
      assertBatchConclusionDuty(actor, current.project_id);
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
        storedTestReportHref(report.lastInsertRowid), report.lastInsertRowid, file.name, batchId,
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
          invalidateUnreleasedRiskTrialAdmission(db, item.version_id, timestamp);
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
