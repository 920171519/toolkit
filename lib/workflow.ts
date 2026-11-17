import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

import { all, one, run, transaction } from "./db";
import {
  canApproveBindingFlow,
  canSubmitBindingFlow,
  canSubmitForPackage,
} from "./permissions";
import { canManageProjectWorkflowForProject, canSubmitIntegrationConclusionForProject } from "./access";
import { assert } from "./services";
import type { SessionUser } from "./types";

function audit(actorId: number, action: string, entityType: string, entityId: number | null, detail: string) {
  run(
    "INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    actorId,
    action,
    entityType,
    entityId,
    detail,
    new Date().toISOString(),
  );
}

const now = () => new Date().toISOString();

function projectForManagement(projectId: number): {
  id: number;
  name: string;
  status: string;
  software_manager_id: number | null;
} {
  const project = one<{ id: number; name: string; status: string; software_manager_id: number | null }>(
    "SELECT id, name, status, software_manager_id FROM projects WHERE id = ?",
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

function activeProjectsForPackage(packageId: number) {
  return all<{ id: number; name: string }>(
    `SELECT DISTINCT p.id, p.name
     FROM package_usages u
     JOIN projects p ON p.id = u.project_id
     WHERE u.package_id = ? AND p.status != 'ARCHIVED'
     ORDER BY p.sort_order, p.id`,
    packageId,
  );
}

function refreshVersionAggregate(versionId: number) {
  const version = one<{ status: string }>("SELECT status FROM package_versions WHERE id = ?", versionId);
  if (!version || version.status === "FORMAL" || version.status === "VOID") {
    const requests = all<{ status: string }>(
      "SELECT status FROM version_transfer_requests WHERE package_version_id = ?",
      versionId,
    );
    if (requests.length === 0 || !requests.every((request) => request.status === "FORMAL")) return;
  }
  const requests = all<{ status: string }>(
    "SELECT status FROM version_transfer_requests WHERE package_version_id = ?",
    versionId,
  );
  if (requests.length === 0) return;
  let status = "PENDING_TRANSFER";
  if (requests.every((request) => request.status === "FORMAL")) status = "FORMAL";
  else if (requests.some((request) => request.status === "TRIAL")) status = "TRIAL";
  else if (requests.some((request) => request.status === "PENDING_FORMAL")) status = "PENDING_FORMAL";
  else if (requests.some((request) => request.status === "IN_TEST")) status = "IN_TEST";
  else if (requests.every((request) => ["PASSED", "FAILED", "BLOCKED", "VOID", "CANCELLED"].includes(request.status))) status = "PENDING_TRIAL";
  else if (requests.some((request) => ["PASSED", "FAILED", "BLOCKED"].includes(request.status))) status = "IN_TEST";
  run("UPDATE package_versions SET status = ?, updated_at = ? WHERE id = ?", status, now(), versionId);
}

export function submitTransfer(
  actor: SessionUser,
  input: { packageId: number; version: string; changeSummary: string; archiveUrl: string },
) {
  const pkg = one<{ id: number; name: string; owner_id: number | null; is_active: number }>(
    "SELECT id, name, owner_id, is_active FROM packages WHERE id = ?",
    input.packageId,
  );
  assert(pkg, "软件包不存在。", "NOT_FOUND");
  assert(pkg.is_active === 1, "该软件包已停用，不能提交转测申请。");
  assert(canSubmitForPackage(actor, pkg.owner_id), "只有该软件包的责任人或软件经理可以提交转测申请。", "FORBIDDEN");
  assert(input.version.trim().length > 0, "请填写版本号。");
  assert(input.changeSummary.trim().length >= 5, "请填写版本变更说明（至少 5 个字符）。");
  assert(/^https?:\/\//i.test(input.archiveUrl.trim()), "归档链接必须以 http:// 或 https:// 开头。");
  const duplicate = one<{ id: number }>(
    "SELECT id FROM package_versions WHERE package_id = ? AND LOWER(version) = LOWER(?)",
    input.packageId,
    input.version.trim(),
  );
  assert(!duplicate, "该版本号已存在，请填写新的版本号。");
  const projects = activeProjectsForPackage(input.packageId);
  assert(projects.length > 0, "该软件包尚未关联任何在行项目的测试节点，无法提交转测。");

  return transaction(() => {
    const timestamp = now();
    const result = run(
      `INSERT INTO package_versions
        (package_id, version, change_summary, archive_url, status, submitted_by, submitted_at, updated_at)
       VALUES (?, ?, ?, ?, 'PENDING_TRANSFER', ?, ?, ?)`,
      input.packageId,
      input.version.trim(),
      input.changeSummary.trim(),
      input.archiveUrl.trim(),
      actor.id,
      timestamp,
      timestamp,
    );
    const versionId = Number(result.lastInsertRowid);
    for (const project of projects) {
      run(
        `INSERT INTO version_transfer_requests
          (package_version_id, project_id, status, submitted_at, updated_at)
         VALUES (?, ?, 'PENDING', ?, ?)`,
        versionId,
        project.id,
        timestamp,
        timestamp,
      );
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
  const version = one<{
    id: number;
    package_id: number;
    package_name: string;
    version: string;
    submitted_by: number | null;
  }>(
    `SELECT pv.id, pv.package_id, p.name AS package_name, pv.version, pv.submitted_by
     FROM package_versions pv JOIN packages p ON p.id = pv.package_id WHERE pv.id = ?`,
    versionId,
  );
  assert(version, "转测申请不存在。", "NOT_FOUND");
  assert(
    ["ADMIN", "SOFTWARE_MANAGER"].includes(actor.role) || version.submitted_by === actor.id,
    "只有申请人或软件经理可以撤回转测申请。",
    "FORBIDDEN",
  );
  const started = one<{ count: number }>(
    "SELECT COUNT(*) AS count FROM version_transfer_requests WHERE package_version_id = ? AND status != 'PENDING'",
    versionId,
  );
  assert(Number(started?.count ?? 0) === 0, "该项目已有版本进入测试或后续流程，不能撤回整份申请。");
  const referenced = one<{ id: number }>(
    `SELECT b.id FROM batch_items bi
     JOIN integration_batches b ON b.id = bi.batch_id
     JOIN version_transfer_requests r ON r.id = bi.transfer_request_id
     WHERE r.package_version_id = ? AND b.status IN ('DRAFT','IN_TEST') LIMIT 1`,
    versionId,
  );
  assert(!referenced, "该申请已被转测批次引用，请先处理对应批次。");
  transaction(() => {
    run("DELETE FROM version_transfer_requests WHERE package_version_id = ?", versionId);
    run("DELETE FROM package_versions WHERE id = ?", versionId);
    audit(actor.id, "CANCEL_TRANSFER", "PACKAGE", version.package_id, `撤回 ${version.package_name} ${version.version} 转测申请`);
  });
}

export type CreateBatchInput = {
  projectId: number;
  code: string;
  title: string;
  items: Array<{ packageId: number; packageVersionId: number }>;
};

export function createBatchDraft(actor: SessionUser, input: CreateBatchInput) {
  const project = assertProjectManager(actor, input.projectId);
  const code = input.code.trim().toUpperCase();
  assert(/^B\d{3,}$/.test(code), "批次号格式应为 B 加至少 3 位数字，例如 B121。");
  const existingCode = one<{ id: number }>("SELECT id FROM integration_batches WHERE UPPER(code) = ?", code);
  assert(!existingCode, `批次号 ${code} 已存在，请更换批次号。`);

  const projectPackages = all<{ packageId: number; packageName: string; packageCode: string }>(
    `SELECT DISTINCT p.id AS packageId, p.name AS packageName, p.code AS packageCode
     FROM package_usages u JOIN packages p ON p.id = u.package_id
     WHERE u.project_id = ? AND p.is_active = 1
     ORDER BY p.name`,
    input.projectId,
  );
  assert(projectPackages.length > 0, "该项目尚未关联任何启用中的软件包，无法组织转测。");
  const selectedByPackage = new Map<number, number>();
  for (const item of input.items) {
    assert(!selectedByPackage.has(item.packageId), "同一个软件包不能在批次中重复出现。");
    selectedByPackage.set(item.packageId, item.packageVersionId);
  }
  assert(
    projectPackages.length === selectedByPackage.size &&
      projectPackages.every((pkg) => selectedByPackage.has(pkg.packageId)),
    "整套配套必须包含本项目全部在用软件包，请刷新页面后重试。",
  );

  const items = projectPackages.map((pkg) => {
    const selectedVersionId = selectedByPackage.get(pkg.packageId);
    assert(selectedVersionId, `请选择 ${pkg.packageName} 的转测版本。`);
    const selected = one<{
      id: number;
      version: string;
      status: string;
      archiveUrl: string;
      changeSummary: string;
    }>(
      `SELECT id, version, status, archive_url AS archiveUrl, change_summary AS changeSummary
       FROM package_versions WHERE id = ? AND package_id = ?`,
      selectedVersionId,
      pkg.packageId,
    );
    assert(selected, `${pkg.packageName} 选择的版本不存在。`);
    const usedInProject = one<{ id: number }>(
      "SELECT id FROM package_usages WHERE package_id = ? AND project_id = ? LIMIT 1",
      pkg.packageId,
      input.projectId,
    );
    assert(usedInProject, `${pkg.packageName} 不在 ${project.name} 项目的使用范围内。`);
    const pendingRequest = one<{ id: number }>(
      "SELECT id FROM version_transfer_requests WHERE package_version_id = ? AND project_id = ? AND status = 'PENDING'",
      selected.id,
      input.projectId,
    );
    if (pendingRequest) {
      const conflict = one<{ id: number }>(
        `SELECT bi.id FROM batch_items bi JOIN integration_batches b ON b.id = bi.batch_id
         WHERE bi.transfer_request_id = ? AND b.status IN ('DRAFT','IN_TEST') LIMIT 1`,
        pendingRequest.id,
      );
      assert(!conflict, `${pkg.packageName} ${selected.version} 已在另一个转测批次中。`);
    }
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
    const previous = one<{ version: string }>(
      `SELECT bi.version FROM batch_items bi JOIN integration_batches b ON b.id = bi.batch_id
       WHERE b.project_id = ? AND bi.package_id = ? AND b.status IN ('IN_TEST','COMPLETED')
       ORDER BY COALESCE(b.completed_at, b.sent_at) DESC, bi.id DESC LIMIT 1`,
      input.projectId,
      pkg.packageId,
    );
    return {
      ...pkg,
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

  return transaction(() => {
    const timestamp = now();
    const result = run(
      `INSERT INTO integration_batches (code, project_id, title, status, created_by, created_at)
       VALUES (?, ?, ?, 'DRAFT', ?, ?)`,
      code,
      input.projectId,
      input.title.trim() || `${project.name} ${code} 整套配套转测`,
      actor.id,
      timestamp,
    );
    const batchId = Number(result.lastInsertRowid);
    for (const item of items) {
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
    }
    audit(actor.id, "CREATE_BATCH", "BATCH", batchId, `创建 ${code}（${project.name}）整套配套转测草稿，${items.length} 个包，${changedCount} 个变更包`);
    return batchId;
  });
}

export function deleteDraftBatch(actor: SessionUser, batchId: number) {
  const batch = one<{ id: number; code: string; status: string; project_id: number }>(
    "SELECT id, code, status, project_id FROM integration_batches WHERE id = ?",
    batchId,
  );
  assert(batch, "转测批次不存在。", "NOT_FOUND");
  assertProjectManager(actor, batch.project_id);
  assert(batch.status === "DRAFT", "只有待发起的草稿批次可以删除。");
  transaction(() => {
    run("DELETE FROM integration_batches WHERE id = ?", batchId);
    audit(actor.id, "DELETE_BATCH_DRAFT", "BATCH", batchId, `删除 ${batch.code} 转测草稿`);
  });
}

export function sendBatch(actor: SessionUser, batchId: number) {
  const batch = one<{ id: number; code: string; status: string; project_id: number; project_name: string }>(
    `SELECT b.id, b.code, b.status, b.project_id, p.name AS project_name
     FROM integration_batches b JOIN projects p ON p.id = b.project_id WHERE b.id = ?`,
    batchId,
  );
  assert(batch, "转测批次不存在。", "NOT_FOUND");
  assertProjectManager(actor, batch.project_id);
  assert(batch.status === "DRAFT", "该批次已不是待发起状态。");
  const items = all<{
    package_name: string;
    version: string;
    transfer_request_id: number | null;
    request_status: string | null;
    package_version_id: number;
  }>(
    `SELECT p.name AS package_name, bi.version, bi.transfer_request_id, r.status AS request_status,
            bi.package_version_id
     FROM batch_items bi JOIN packages p ON p.id = bi.package_id
     LEFT JOIN version_transfer_requests r ON r.id = bi.transfer_request_id
     WHERE bi.batch_id = ? AND bi.transfer_request_id IS NOT NULL`,
    batchId,
  );
  assert(items.length > 0, "批次中没有待转测的新版本。");
  for (const item of items) {
    assert(item.request_status === "PENDING", `${item.package_name} ${item.version} 的转测申请已不在待测试状态，请重新创建批次。`);
    const conflict = one<{ id: number }>(
      `SELECT b.id FROM batch_items bi JOIN integration_batches b ON b.id = bi.batch_id
       WHERE bi.transfer_request_id = ? AND b.status = 'IN_TEST' LIMIT 1`,
      item.transfer_request_id,
    );
    assert(!conflict, `${item.package_name} ${item.version} 已在另一轮集成测试中。`);
  }
  transaction(() => {
    const timestamp = now();
    run("UPDATE integration_batches SET status = 'IN_TEST', sent_at = ? WHERE id = ?", timestamp, batchId);
    const versionIds = new Set<number>();
    for (const item of items) {
      run("UPDATE version_transfer_requests SET status = 'IN_TEST', updated_at = ? WHERE id = ?", timestamp, item.transfer_request_id);
      versionIds.add(item.package_version_id);
    }
    for (const versionId of versionIds) refreshVersionAggregate(versionId);
    audit(actor.id, "SEND_BATCH", "BATCH", batchId, `发起 ${batch.code}（${batch.project_name}）整套配套转测，${items.length} 个变更包`);
  });
}

export function terminateBatch(actor: SessionUser, batchId: number, reason: string) {
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
  transaction(() => {
    const timestamp = now();
    run("UPDATE integration_batches SET status = 'TERMINATED', terminated_at = ?, terminate_reason = ? WHERE id = ?", timestamp, reason.trim(), batchId);
    for (const request of requests) {
      run("UPDATE version_transfer_requests SET status = 'PENDING', updated_at = ? WHERE id = ?", timestamp, request.id);
      refreshVersionAggregate(request.package_version_id);
    }
    audit(actor.id, "TERMINATE_BATCH", "BATCH", batchId, `终止 ${batch.code} 集成测试：${reason.trim()}`);
  });
}

const REPORT_EXTENSIONS = new Set([".pdf", ".png", ".jpg", ".jpeg", ".docx", ".xlsx", ".txt", ".zip"]);
const MAX_REPORT_BYTES = 15 * 1024 * 1024;

async function storeReport(actor: SessionUser, file: File): Promise<{ id: number; name: string }> {
  assert(file.size > 0, "请选择验证报告文件。");
  assert(file.size <= MAX_REPORT_BYTES, "验证报告不能超过 15MB。");
  const extension = extname(file.name).toLowerCase();
  assert(REPORT_EXTENSIONS.has(extension), "验证报告仅支持 PDF、图片、Word、Excel、TXT 或 ZIP 文件。");
  const directory = join(process.cwd(), "data", "uploads", "reports");
  mkdirSync(directory, { recursive: true });
  const fileName = `report-${Date.now()}-${randomUUID()}${extension}`;
  const absolutePath = join(directory, fileName);
  writeFileSync(absolutePath, Buffer.from(await file.arrayBuffer()));
  const relativePath = join("data", "uploads", "reports", fileName);
  const timestamp = now();
  const result = run(
    `INSERT INTO report_files (original_name, stored_path, mime_type, size_bytes, uploaded_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    file.name,
    relativePath,
    file.type || "application/octet-stream",
    file.size,
    actor.id,
    timestamp,
  );
  return { id: Number(result.lastInsertRowid), name: file.name };
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
    conclusion: "PASS" | "FAIL" | "BLOCKED";
    issueAttribution: "NONE" | "PACKAGE_RELATED" | "NOT_PACKAGE_RELATED" | "UNKNOWN";
    testSummary: string;
    reportFile: File | null;
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
  if (input.conclusion === "PASS") assert(input.issueAttribution === "NONE", "测试通过时问题归属应为“未发现问题”。");
  if (input.conclusion === "FAIL") assert(input.issueAttribution === "PACKAGE_RELATED" || input.issueAttribution === "NOT_PACKAGE_RELATED", "测试不通过时需要判断问题是否与软件包相关。");
  if (input.conclusion === "BLOCKED") assert(input.issueAttribution === "UNKNOWN", "无法完成验证时问题归属应为“原因待定位”。");
  assert(input.reportFile, "请上传验证报告。");
  const report = await storeReport(actor, input.reportFile!);
  const requests = all<{ id: number; package_version_id: number }>(
    `SELECT r.id, r.package_version_id FROM batch_items bi
     JOIN version_transfer_requests r ON r.id = bi.transfer_request_id
     WHERE bi.batch_id = ?`,
    batchId,
  );
  transaction(() => {
    const timestamp = now();
    run(
      `UPDATE integration_batches SET status = 'COMPLETED', completed_at = ?, conclusion = ?,
              issue_attribution = ?, test_summary = ?, test_report_url = ?,
              test_report_file_id = ?, test_report_name = ? WHERE id = ?`,
      timestamp,
      input.conclusion,
      input.issueAttribution,
      input.testSummary.trim(),
      `/api/reports/${report.id}`,
      report.id,
      report.name,
      batchId,
    );
    const requestStatus = input.conclusion === "PASS" ? "PASSED" : input.conclusion === "FAIL" ? "FAILED" : "BLOCKED";
    const versionIds = new Set<number>();
    for (const request of requests) {
      run("UPDATE version_transfer_requests SET status = ?, updated_at = ? WHERE id = ?", requestStatus, timestamp, request.id);
      versionIds.add(request.package_version_id);
    }
    for (const versionId of versionIds) refreshVersionAggregate(versionId);
    audit(actor.id, "COMPLETE_BATCH", "BATCH", batchId, `提交 ${batch.code} 测试结论：${input.conclusion}，上传报告 ${report.name}`);
  });
}

export function releaseTrial(actor: SessionUser, requestId: number, trialFormNo: string, riskConclusion = "") {
  assert(trialFormNo.trim().length >= 3, "请填写发布试制电子流。");
  const anchor = one<{
    id: number;
    package_version_id: number;
    package_id: number;
    package_name: string;
    version: string;
  }>(
    `SELECT r.id, r.package_version_id, p.id AS package_id, p.name AS package_name, pv.version
     FROM version_transfer_requests r
     JOIN package_versions pv ON pv.id = r.package_version_id
     JOIN packages p ON p.id = pv.package_id
     WHERE r.id = ?`,
    requestId,
  );
  assert(anchor, "项目版本记录不存在。", "NOT_FOUND");

  const requests = all<{
    id: number;
    project_id: number;
    project_name: string;
    status: string;
    batch_id: number | null;
    batch_conclusion: string | null;
  }>(
    `SELECT r.id, r.project_id, pr.name AS project_name, r.status,
            b.id AS batch_id, b.conclusion AS batch_conclusion
     FROM version_transfer_requests r
     JOIN projects pr ON pr.id = r.project_id
     LEFT JOIN integration_batches b ON b.id = (
       SELECT bi.batch_id FROM batch_items bi WHERE bi.transfer_request_id = r.id ORDER BY bi.id DESC LIMIT 1
     )
     WHERE r.package_version_id = ? AND pr.status != 'ARCHIVED'
     ORDER BY pr.sort_order`,
    anchor.package_version_id,
  );
  assert(requests.length > 0, "该版本没有可发布试制的项目记录。", "NOT_FOUND");
  assert(
    requests.some((request) => canManageProjectWorkflowForProject(actor, request.project_id)),
    "只有使用该软件包的项目软件经理或系统管理员可以发布试制。",
    "FORBIDDEN",
  );
  const usageProjects = all<{ id: number; name: string }>(
    `SELECT DISTINCT pr.id, pr.name
     FROM package_usages u JOIN projects pr ON pr.id = u.project_id
     WHERE u.package_id = ? AND pr.status != 'ARCHIVED'
     ORDER BY pr.sort_order`,
    anchor.package_id,
  );
  assert(usageProjects.length > 0, "该软件包没有在行项目使用范围，无法发布试制。");
  const requestByProject = new Map(requests.map((request) => [request.project_id, request]));
  for (const project of usageProjects) {
    assert(
      requestByProject.has(project.id),
      `${project.name} 尚未转测该版本，不能发布试制。所有使用项目都需先完成集成测试验收。`,
    );
  }
  for (const request of requests) {
    assert(
      ["PASSED", "FAILED", "BLOCKED"].includes(request.status),
      `${request.project_name} 的集成测试尚未完成，不能发布试制。`,
    );
  }
  const riskRequired = requests.some(
    (request) => request.status !== "PASSED" || request.batch_id === null,
  );
  if (riskRequired) {
    assert(riskConclusion.trim().length >= 5, "存在未通过集成测试或未关联转测批次的项目，请填写全版本风险发布结论。");
  }

  const requirementsToCreate: Array<{
    requestId: number;
    projectId: number;
    projectName: string;
    nodeId: number;
    nodeName: string;
    requiredCount: number;
    bindingOwnerId: number;
    bindingApproverId: number;
    approverPool: number[];
  }> = [];
  for (const request of requests) {
    const usages = all<{
      node_id: number;
      node_name: string;
      required_count: number;
      binding_owner_id: number | null;
      binding_approver_id: number | null;
    }>(
      `SELECT u.node_id, n.name AS node_name, n.required_binding_count AS required_count,
              n.binding_owner_id, n.binding_approver_id
       FROM package_usages u JOIN project_nodes n ON n.id = u.node_id
       WHERE u.package_id = ? AND u.project_id = ?
       ORDER BY n.sort_order`,
      anchor.package_id,
      request.project_id,
    );
    assert(usages.length > 0, `${request.project_name} 没有该软件包的测试节点，无法发布试制。`);
    for (const usage of usages) {
      assert(usage.binding_owner_id, `${request.project_name} / ${usage.node_name} 未配置绑定验证责任人。`);
      assert(usage.binding_approver_id, `${request.project_name} / ${usage.node_name} 未配置绑定电子流审批人。`);
      const pool = all<{ userId: number }>(
        "SELECT user_id AS userId FROM project_node_approvers WHERE node_id = ? ORDER BY id",
        usage.node_id,
      ).map((row) => row.userId);
      requirementsToCreate.push({
        requestId: request.id,
        projectId: request.project_id,
        projectName: request.project_name,
        nodeId: usage.node_id,
        nodeName: usage.node_name,
        requiredCount: Math.max(1, usage.required_count),
        bindingOwnerId: usage.binding_owner_id!,
        bindingApproverId: usage.binding_approver_id!,
        approverPool: pool.length > 0 ? pool : [usage.binding_approver_id!],
      });
    }
  }

  return transaction(() => {
    const timestamp = now();
    run(
      `UPDATE package_versions
       SET status = 'TRIAL', trial_form_no = ?, trial_released_at = ?, release_mode = ?,
           risk_conclusion = ?, updated_at = ?
       WHERE id = ?`,
      trialFormNo.trim(),
      timestamp,
      riskRequired ? "RISK" : "INTEGRATION",
      riskRequired ? riskConclusion.trim() : null,
      timestamp,
      anchor.package_version_id,
    );
    for (const request of requests) {
      run(
        `UPDATE version_transfer_requests
         SET status = 'TRIAL', trial_form_no = ?, trial_released_at = ?, trial_released_by = ?,
             release_mode = ?, risk_conclusion = ?, updated_at = ?
         WHERE id = ?`,
        trialFormNo.trim(),
        timestamp,
        actor.id,
        riskRequired ? "RISK" : "INTEGRATION",
        riskRequired ? riskConclusion.trim() : null,
        timestamp,
        request.id,
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
      for (const approverId of item.approverPool) {
        run(
          "INSERT OR IGNORE INTO binding_requirement_approvers (requirement_id, user_id, created_at) VALUES (?, ?, ?)",
          requirementId,
          approverId,
          timestamp,
        );
      }
    }
    refreshVersionAggregate(anchor.package_version_id);
    audit(
      actor.id,
      "RELEASE_TRIAL",
      "PACKAGE",
      anchor.package_id,
      `按全项目共享发布 ${anchor.package_name} ${anchor.version} 试制版本，覆盖 ${requests.length} 个项目、${requirementsToCreate.length} 个节点绑定任务，电子流 ${trialFormNo.trim()}${riskRequired ? "（风险发布）" : ""}`,
    );
    return requirementsToCreate.length;
  });
}

export function voidTrial(actor: SessionUser, requestId: number, reason: string) {
  assert(reason.trim().length >= 5, "请填写作废原因。");
  const anchor = one<{
    id: number;
    package_version_id: number;
    package_id: number;
    package_name: string;
    version: string;
  }>(
    `SELECT r.id, r.package_version_id, p.id AS package_id, p.name AS package_name, pv.version
     FROM version_transfer_requests r
     JOIN package_versions pv ON pv.id = r.package_version_id
     JOIN packages p ON p.id = pv.package_id
     WHERE r.id = ?`,
    requestId,
  );
  assert(anchor, "项目版本记录不存在。", "NOT_FOUND");
  const requests = all<{ id: number; project_id: number; project_name: string; status: string }>(
    `SELECT r.id, r.project_id, pr.name AS project_name, r.status
     FROM version_transfer_requests r JOIN projects pr ON pr.id = r.project_id
     WHERE r.package_version_id = ? AND pr.status != 'ARCHIVED'
     ORDER BY pr.sort_order`,
    anchor.package_version_id,
  );
  assert(requests.length > 0, "该版本没有可作废的项目记录。", "NOT_FOUND");
  assert(
    requests.some((request) => canManageProjectWorkflowForProject(actor, request.project_id)),
    "只有使用该软件包的项目软件经理或系统管理员可以作废试制版本。",
    "FORBIDDEN",
  );
  assert(requests.some((request) => request.status === "TRIAL"), "只有试制验证中的版本可以作废。");
  transaction(() => {
    const timestamp = now();
    run(
      "UPDATE package_versions SET status = 'VOID', void_reason = ?, voided_at = ?, updated_at = ? WHERE id = ?",
      reason.trim(),
      timestamp,
      timestamp,
      anchor.package_version_id,
    );
    for (const request of requests) {
      run(
        "UPDATE version_transfer_requests SET status = 'VOID', void_reason = ?, voided_at = ?, updated_at = ? WHERE id = ?",
        reason.trim(),
        timestamp,
        timestamp,
        request.id,
      );
    }
    audit(
      actor.id,
      "VOID_TRIAL",
      "PACKAGE",
      anchor.package_id,
      `作废 ${anchor.package_name} ${anchor.version} 共享试制版本，覆盖 ${requests.length} 个项目：${reason.trim()}。待处理绑定电子流提交人将收到撤回提醒`,
    );
  });
}

export function submitBindingFlow(actor: SessionUser, requirementId: number, barcodes: string[], approverId: number, webUrl: string) {
  const normalizedBarcodes = [...new Set(barcodes.map((barcode) => barcode.trim()).filter(Boolean))];
  assert(normalizedBarcodes.length > 0, "请至少添加一个设备条码。");
  assert(/^https?:\/\//i.test(webUrl.trim()), "请填写有效的网页电子流地址（http/https）。");
  for (const barcode of normalizedBarcodes) {
    assert(barcode.length >= 3 && barcode.length <= 80, "设备条码长度需为 3-80 个字符。");
  }
  const requirement = one<{
    id: number;
    request_id: number;
    request_status: string;
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
  }>(
    `SELECT br.id, br.request_id, r.status AS request_status, br.package_version_id, p.id AS package_id,
            p.name AS package_name, pv.version, br.binding_owner_id, br.approver_id, br.project_id,
            pr.name AS project_name, br.node_id, n.name AS node_name
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
  assert(requirement.request_status === "TRIAL", "该试制版本已结束绑定验证，不能提交绑定电子流。");
  assert(
    canSubmitBindingFlow(actor, requirement.binding_owner_id),
    "只有该节点的绑定验证责任人、硬件验证角色或管理人员可以提交绑定电子流。",
    "FORBIDDEN",
  );
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
       WHERE f.requirement_id = ? AND b.barcode = ? AND f.status IN ('PENDING','APPROVED') LIMIT 1`,
      requirementId,
      barcode,
    );
    assert(!duplicate, `设备条码 ${barcode} 已提交过绑定电子流。`);
  }
  return transaction(() => {
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
    return { flowId, flowNo };
  });
}

export function cancelBindingFlow(actor: SessionUser, flowId: number, reason: string) {
  const flow = one<{ id: number; submitted_by: number | null; status: string; requirement_id: number }>(
    "SELECT id, submitted_by, status, requirement_id FROM binding_flows WHERE id = ?",
    flowId,
  );
  assert(flow, "绑定电子流不存在。", "NOT_FOUND");
  assert(flow.status === "PENDING", "只能撤销待审批的绑定电子流。");
  assert(
    flow.submitted_by === actor.id || ["ADMIN", "SOFTWARE_MANAGER"].includes(actor.role),
    "只有提交人或软件经理可以撤销绑定电子流。",
    "FORBIDDEN",
  );
  transaction(() => {
    run(
      "UPDATE binding_flows SET status = 'CANCELLED', cancelled_at = ?, cancel_reason = ? WHERE id = ?",
      now(),
      reason.trim() || "提交人撤销",
      flowId,
    );
    audit(actor.id, "CANCEL_BINDING_FLOW", "BINDING_FLOW", flowId, `撤销绑定电子流${reason.trim() ? `：${reason.trim()}` : ""}`);
  });
}

export function decideBindingFlow(
  actor: SessionUser,
  flowId: number,
  decision: "APPROVED" | "REJECTED",
  comment: string,
) {
  assert(comment.trim().length >= 2, "请填写审批意见。");
  const flow = one<{
    id: number;
    submitted_by: number | null;
    approver_id: number | null;
    status: string;
    requirement_id: number;
    request_id: number;
    request_status: string;
    version_id: number;
    package_id: number;
    package_name: string;
    version: string;
    project_name: string;
    node_name: string;
  }>(
    `SELECT f.id, f.submitted_by, f.approver_id, f.status, f.requirement_id, br.request_id,
            r.status AS request_status, f.package_version_id AS version_id, p.id AS package_id,
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
  assert(flow.status === "PENDING", "该绑定电子流已处理。");
  assert(canApproveBindingFlow(actor, flow.approver_id), "只有该节点的绑定电子流审批人或管理员可以审批。", "FORBIDDEN");
  assert(flow.submitted_by !== actor.id, "不能审批自己提交的绑定电子流。");
  assert(flow.request_status === "TRIAL", "该试制版本已作废或已进入转正，请撤销电子流。");
  return transaction(() => {
    const timestamp = now();
    run(
      "UPDATE binding_flows SET status = ?, reviewed_at = ?, review_comment = ? WHERE id = ?",
      decision,
      timestamp,
      comment.trim(),
      flowId,
    );
    let enteredFormal = false;
    if (decision === "APPROVED") {
      const requirement = one<{ required_count: number }>(
        "SELECT required_count FROM binding_requirements WHERE id = ?",
        flow.requirement_id,
      );
      const counts = one<{ approved: number }>(
        `SELECT COUNT(*) AS approved FROM binding_flow_barcodes b
         JOIN binding_flows f ON f.id = b.flow_id
         WHERE f.requirement_id = ? AND f.status = 'APPROVED'`,
        flow.requirement_id,
      );
      const approvedCount = Number(counts?.approved ?? 0);
      if (requirement && approvedCount >= requirement.required_count) {
        run("UPDATE binding_requirements SET status = 'PASSED', updated_at = ? WHERE id = ?", timestamp, flow.requirement_id);
        const extraPending = all<{ id: number }>(
          "SELECT id FROM binding_flows WHERE requirement_id = ? AND status = 'PENDING'",
          flow.requirement_id,
        );
        for (const pending of extraPending) {
          run(
            "UPDATE binding_flows SET status = 'CANCELLED', cancelled_at = ?, cancel_reason = '该节点绑定通过数量已满足，系统关闭剩余电子流' WHERE id = ?",
            timestamp,
            pending.id,
          );
        }
      }
      const requirements = all<{ status: string }>(
        "SELECT status FROM binding_requirements WHERE request_id = ?",
        flow.request_id,
      );
      if (requirements.length > 0 && requirements.every((item) => item.status === "PASSED")) {
        // 本项目绑定已满足，先关闭本项目剩余待审批电子流。
        const pendingFlows = all<{ id: number }>(
          "SELECT id FROM binding_flows WHERE requirement_id IN (SELECT id FROM binding_requirements WHERE request_id = ?) AND status = 'PENDING'",
          flow.request_id,
        );
        for (const pending of pendingFlows) {
          run(
            "UPDATE binding_flows SET status = 'CANCELLED', cancelled_at = ?, cancel_reason = '绑定通过数量已满足，系统关闭剩余电子流' WHERE id = ?",
            timestamp,
            pending.id,
          );
        }
        // 试制按软件包版本共享：必须全部使用项目都完成绑定，才整体进入待转正。
        const versionRequirementSummary = one<{ total: number; passed: number }>(
          `SELECT COUNT(*) AS total,
                  SUM(CASE WHEN br.status = 'PASSED' THEN 1 ELSE 0 END) AS passed
           FROM binding_requirements br
           JOIN version_transfer_requests r ON r.id = br.request_id
           WHERE r.package_version_id = ?`,
          flow.version_id,
        );
        const versionReady =
          Number(versionRequirementSummary?.total ?? 0) > 0 &&
          Number(versionRequirementSummary?.passed ?? 0) === Number(versionRequirementSummary?.total ?? 0);
        if (versionReady) {
          run("UPDATE version_transfer_requests SET status = 'PENDING_FORMAL', updated_at = ? WHERE package_version_id = ?", timestamp, flow.version_id);
          const allPendingFlows = all<{ id: number }>(
            `SELECT id FROM binding_flows WHERE requirement_id IN (
               SELECT br.id FROM binding_requirements br
               JOIN version_transfer_requests r ON r.id = br.request_id
               WHERE r.package_version_id = ?
             ) AND status = 'PENDING'`,
            flow.version_id,
          );
          for (const pending of allPendingFlows) {
            run(
              "UPDATE binding_flows SET status = 'CANCELLED', cancelled_at = ?, cancel_reason = '该软件包全部项目绑定已满足，系统关闭剩余电子流' WHERE id = ?",
              timestamp,
              pending.id,
            );
          }
          enteredFormal = true;
          refreshVersionAggregate(flow.version_id);
        }
      }
    }
    audit(
      actor.id,
      decision === "APPROVED" ? "APPROVE_BINDING_FLOW" : "REJECT_BINDING_FLOW",
      "BINDING_FLOW",
      flowId,
      `${decision === "APPROVED" ? "通过" : "驳回"} ${flow.package_name} ${flow.version} 在 ${flow.project_name}/${flow.node_name} 的绑定电子流：${comment.trim()}${enteredFormal ? "。该版本全部项目绑定完成，已进入待转正" : ""}`,
    );
    return { enteredFormal };
  });
}

export function releaseFormal(actor: SessionUser, requestId: number, flowNo: string) {
  assert(flowNo.trim().length >= 3, "请填写转正电子流。");
  const anchor = one<{
    id: number;
    package_version_id: number;
    package_id: number;
    package_name: string;
    version: string;
  }>(
    `SELECT r.id, r.package_version_id, p.id AS package_id, p.name AS package_name, pv.version
     FROM version_transfer_requests r
     JOIN package_versions pv ON pv.id = r.package_version_id
     JOIN packages p ON p.id = pv.package_id
     WHERE r.id = ?`,
    requestId,
  );
  assert(anchor, "项目版本记录不存在。", "NOT_FOUND");
  const requests = all<{ id: number; project_id: number; project_name: string; status: string }>(
    `SELECT r.id, r.project_id, pr.name AS project_name, r.status
     FROM version_transfer_requests r JOIN projects pr ON pr.id = r.project_id
     WHERE r.package_version_id = ? AND pr.status != 'ARCHIVED'
     ORDER BY pr.sort_order`,
    anchor.package_version_id,
  );
  assert(requests.length > 0, "该版本没有可转正的项目记录。", "NOT_FOUND");
  assert(
    requests.some((request) => canManageProjectWorkflowForProject(actor, request.project_id)),
    "只有使用该软件包的项目软件经理或系统管理员可以发布转正。",
    "FORBIDDEN",
  );
  for (const request of requests) {
    assert(request.status === "PENDING_FORMAL", `${request.project_name} 尚未完成全部项目绑定验证，不能转正。`);
  }
  const summary = one<{ total: number; passed: number }>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN br.status = 'PASSED' THEN 1 ELSE 0 END) AS passed
     FROM binding_requirements br
     JOIN version_transfer_requests r ON r.id = br.request_id
     WHERE r.package_version_id = ?`,
    anchor.package_version_id,
  );
  assert(
    Number(summary?.total ?? 0) > 0 && Number(summary?.passed ?? 0) === Number(summary?.total ?? 0),
    "该软件包仍有项目绑定验证未全部通过，不能转正。",
  );
  return transaction(() => {
    const timestamp = now();
    run(
      `UPDATE package_versions SET status = 'FORMAL', formal_released_at = ?, form_flow_no = ?, updated_at = ? WHERE id = ?`,
      timestamp,
      flowNo.trim(),
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
        flowNo.trim(),
        timestamp,
        request.id,
      );
    }
    refreshVersionAggregate(anchor.package_version_id);
    audit(
      actor.id,
      "RELEASE_FORMAL",
      "PACKAGE",
      anchor.package_id,
      `${anchor.package_name} ${anchor.version} 全项目绑定完成，按共享版本发布正式版本，覆盖 ${requests.length} 个项目，转正电子流：${flowNo.trim()}`,
    );
  });
}
