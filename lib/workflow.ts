import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

import { all, one, run, transaction } from "./db";
import {
  canApproveBindingFlow,
  canSubmitBindingFlow,
} from "./permissions";
import { canManageProjectWorkflowForProject, canSubmitIntegrationConclusionForProject, getTransferAreaIds } from "./access";
import { assert } from "./services";
import { getTrialReadyVersions } from "./workflow-queries";
import { getRiskTrialEntries } from "./trial-risk-entry";
import { trialReleaseStateKey } from "./trial-release-state";
import type { SessionUser } from "./types";
import { getPreviousBatchVersion } from "./workflow-queries";

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

function hasActiveIntegrationBatch(versionId: number) {
  return Boolean(one<{ id: number }>(
    `SELECT b.id FROM batch_items bi
     JOIN integration_batches b ON b.id = bi.batch_id
     JOIN projects p ON p.id = b.project_id
     WHERE bi.package_version_id = ? AND bi.transfer_request_id IS NOT NULL
       AND b.status IN ('DRAFT','IN_TEST') AND p.status != 'ARCHIVED' LIMIT 1`,
    versionId,
  ));
}

function refreshTrialReadiness(versionId: number, timestamp: string) {
  const version = one<{ status: string; binding_mode: string }>(
    "SELECT status, binding_mode FROM package_versions WHERE id = ?",
    versionId,
  );
  if (!version || !["TRIAL", "PENDING_FORMAL"].includes(version.status)) return false;

  const outstanding = one<{ id: number }>(
    `SELECT id FROM binding_requirements WHERE package_version_id = ?
     AND status != 'PASSED' AND NOT (status = 'CANCELLED' AND waived_at IS NOT NULL) LIMIT 1`,
    versionId,
  );
  const bindingReady = version.binding_mode === "SKIPPED" || (version.binding_mode === "PUSHED" && !outstanding);
  const nextStatus = bindingReady && !hasActiveIntegrationBatch(versionId) ? "PENDING_FORMAL" : "TRIAL";
  if (version.status === nextStatus) return false;
  run("UPDATE package_versions SET status = ?, updated_at = ? WHERE id = ?", nextStatus, timestamp, versionId);
  run(
    `UPDATE version_transfer_requests SET status = ?, updated_at = ?
     WHERE package_version_id = ? AND status IN ('TRIAL','PENDING_FORMAL')`,
    nextStatus,
    timestamp,
    versionId,
  );
  return nextStatus === "PENDING_FORMAL";
}

export function submitTransfer(
  actor: SessionUser,
  input: { packageId: number; version: string; changeSummary: string; archiveUrl: string; buildUrl: string; scopeProjectId?: number },
) {
  const pkg = one<{ id: number; name: string; area_id: number | null; is_active: number }>(
    "SELECT id, name, area_id, is_active FROM packages WHERE id = ?",
    input.packageId,
  );
  assert(pkg, "软件包不存在。", "NOT_FOUND");
  assert(pkg.is_active === 1, "该软件包已停用，不能提交转测申请。");
  const areaIds = getTransferAreaIds(actor);
  assert(areaIds === null || (pkg.area_id !== null && areaIds.includes(pkg.area_id)), "只能提交所属责任田的软件包转测。", "FORBIDDEN");
  assert(input.version.trim().length > 0, "请填写版本号。");
  assert(input.changeSummary.trim().length >= 5, "请填写版本变更说明（至少 5 个字符）。");
  assert(/^https?:\/\//i.test(input.archiveUrl.trim()), "归档链接必须以 http:// 或 https:// 开头。");
  assert(/^https?:\/\//i.test(input.buildUrl.trim()), "构建地址必须以 http:// 或 https:// 开头。");
  const duplicate = one<{ id: number }>(
    "SELECT id FROM package_versions WHERE package_id = ? AND LOWER(version) = LOWER(?)",
    input.packageId,
    input.version.trim(),
  );
  assert(!duplicate, "该版本号已存在，请填写新的版本号。");
  const projects = activeProjectsForPackage(input.packageId);
  assert(projects.length > 0, "该软件包尚未关联任何在行项目的测试节点，无法提交转测。");
  if (input.scopeProjectId !== undefined) {
    assert(projects.some((project) => project.id === input.scopeProjectId), "所选软件包不在当前项目的使用范围内。");
  }

  return transaction(() => {
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
  items: Array<{ packageId: number; packageVersionId: number; carryPrevious?: boolean }>;
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
  const selectedByPackage = new Map(input.items.map((item) => [item.packageId, item]));
  assert(selectedByPackage.size === input.items.length, "同一个软件包不能在批次中重复出现。");
  const selectedPackages = projectPackages.filter((pkg) => selectedByPackage.has(pkg.packageId));
  assert(selectedPackages.length > 0, "请至少选择一个软件包加入本次转测。");
  assert(selectedPackages.length === selectedByPackage.size, "只能选择本项目启用的在用软件包，请刷新页面后重试。");

  return transaction(() => {
    const items = selectedPackages.map((pkg) => {
      const selection = selectedByPackage.get(pkg.packageId);
      assert(selection, `请选择 ${pkg.packageName} 的转测版本。`);
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
      assert(selected, `${pkg.packageName} 选择的版本不存在。`);
      const usedInProject = one<{ id: number }>(
        "SELECT id FROM package_usages WHERE package_id = ? AND project_id = ? LIMIT 1",
        pkg.packageId,
        input.projectId,
      );
      assert(usedInProject, `${pkg.packageName} 不在 ${project.name} 项目的使用范围内。`);
      const previous = getPreviousBatchVersion(input.projectId, pkg.packageId);
      if (selection.carryPrevious) {
        assert(
          previous?.canCarry && previous.versionId === selected.id,
          `${pkg.packageName} 无法沿用所选的上次转测版本，请刷新后重试。`,
        );
      }
      const pendingRequest = selection.carryPrevious ? null : one<{ id: number }>(
        `SELECT id FROM version_transfer_requests WHERE package_version_id = ? AND project_id = ?
         AND status IN ('PENDING','TRIAL','PENDING_FORMAL') AND COALESCE(integration_status, status) = 'PENDING'`,
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

    const timestamp = now();
    const result = run(
      `INSERT INTO integration_batches (code, project_id, title, status, created_by, created_at)
       VALUES (?, ?, ?, 'DRAFT', ?, ?)`,
      code,
      input.projectId,
      input.title.trim() || `${project.name} ${code} 整套转测`,
      actor.id,
      timestamp,
    );
    const batchId = Number(result.lastInsertRowid);
    for (const item of items) {
      if (item.requestId) {
        const available = one<{ id: number }>(
          `SELECT r.id FROM version_transfer_requests r WHERE r.id = ?
           AND r.status IN ('PENDING','TRIAL','PENDING_FORMAL') AND COALESCE(r.integration_status, r.status) = 'PENDING'
           AND NOT EXISTS (
             SELECT 1 FROM batch_items bi JOIN integration_batches b ON b.id = bi.batch_id
             WHERE bi.transfer_request_id = r.id AND b.status IN ('DRAFT','IN_TEST')
           )`,
          item.requestId,
        );
        assert(available, `${item.packageName} ${item.version} 的转测状态已变化，请刷新后重试。`);
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
      if (item.requestId) refreshTrialReadiness(item.versionId, timestamp);
    }
    audit(actor.id, "CREATE_BATCH", "BATCH", batchId, `创建 ${code}（${project.name}）转测草稿，${items.length} 个包，${changedCount} 个变更包`);
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
    for (const version of versionIds) refreshTrialReadiness(version.id, timestamp);
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
    const items = all<{
      package_name: string;
      version: string;
      transfer_request_id: number | null;
      request_status: string | null;
      package_version_id: number;
    }>(
      `SELECT p.name AS package_name, bi.version, bi.transfer_request_id,
              CASE WHEN r.status IN ('PENDING','TRIAL','PENDING_FORMAL')
                THEN COALESCE(r.integration_status, r.status) ELSE r.status END AS request_status,
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
    const timestamp = now();
    run("UPDATE integration_batches SET status = 'IN_TEST', sent_at = ? WHERE id = ?", timestamp, batchId);
    const versionIds = new Set<number>();
    for (const item of items) {
      run(
        `UPDATE version_transfer_requests
         SET status = CASE WHEN status = 'PENDING' THEN 'IN_TEST' ELSE status END,
             integration_status = CASE WHEN integration_status IS NOT NULL THEN 'IN_TEST' END, updated_at = ?
         WHERE id = ?`,
        timestamp,
        item.transfer_request_id,
      );
      versionIds.add(item.package_version_id);
    }
    for (const versionId of versionIds) {
      refreshVersionAggregate(versionId);
      refreshTrialReadiness(versionId, timestamp);
    }
    audit(actor.id, "SEND_BATCH", "BATCH", batchId, `发起 ${batch.code}（${batch.project_name}）整套配套转测，${items.length} 个变更包`);
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
         WHERE id = ?`,
        timestamp,
        request.id,
      );
      refreshVersionAggregate(request.package_version_id);
      refreshTrialReadiness(request.package_version_id, timestamp);
    }
    run(
      "UPDATE trial_risk_admissions SET invalidated_at = ? WHERE batch_id = ? AND stage = 'IN_TEST' AND invalidated_at IS NULL",
      timestamp, batchId,
    );
    audit(actor.id, "TERMINATE_BATCH", "BATCH", batchId, `终止 ${batch.code} 集成测试：${reason.trim()}`);
  });
}

const REPORT_EXTENSIONS = new Set([".pdf", ".png", ".jpg", ".jpeg", ".docx", ".xlsx", ".txt", ".zip"]);
const MAX_REPORT_BYTES = 15 * 1024 * 1024;

function reportStoragePath(file: File) {
  assert(file.size > 0, "请选择验证报告文件。");
  assert(file.size <= MAX_REPORT_BYTES, "验证报告不能超过 15MB。");
  const extension = extname(file.name).toLowerCase();
  assert(REPORT_EXTENSIONS.has(extension), "验证报告仅支持 PDF、图片、Word、Excel、TXT 或 ZIP 文件。");
  return join("data", "uploads", "reports", `report-${Date.now()}-${randomUUID()}${extension}`);
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
  if (input.conclusion === "PASS") assert(input.issueAttribution === "NONE", "测试通过时问题归属应为“未发现问题”。");
  if (input.conclusion === "FAIL") assert(input.issueAttribution === "PACKAGE_RELATED" || input.issueAttribution === "NOT_PACKAGE_RELATED", "测试不通过时需要判断问题是否与软件包相关。");
  if (input.conclusion === "BLOCKED") assert(input.issueAttribution === "UNKNOWN", "无法完成验证时问题归属应为“原因待定位”。");
  assert(input.reportFile, "请上传验证报告。");
  const file = input.reportFile;
  const relativePath = reportStoragePath(file);
  const absolutePath = join(process.cwd(), relativePath);
  const bytes = Buffer.from(await file.arrayBuffer());
  let reportWritten = false;
  try {
    return transaction(() => {
      const current = one<{ status: string }>("SELECT status FROM integration_batches WHERE id = ?", batchId);
      assert(current?.status === "IN_TEST", "该批次状态已变化，请刷新后重试。");
      const items = all<{
        version_id: number;
        request_id: number | null;
        parallel_risk_trial: number;
        package_name: string;
        version: string;
      }>(
        `SELECT bi.package_version_id AS version_id, bi.transfer_request_id AS request_id,
                bi.transfer_request_id IS NOT NULL AND pv.release_mode = 'RISK'
                  AND pv.status IN ('TRIAL','PENDING_FORMAL') AS parallel_risk_trial,
                p.name AS package_name, bi.version
         FROM batch_items bi JOIN package_versions pv ON pv.id = bi.package_version_id
         JOIN packages p ON p.id = bi.package_id WHERE bi.batch_id = ?`,
        batchId,
      );
      const affected = new Set(input.conclusion === "FAIL" && input.issueAttribution === "PACKAGE_RELATED"
        ? input.affectedVersionIds : []);
      if (input.conclusion === "FAIL" && input.issueAttribution === "PACKAGE_RELATED" && items.some((item) => item.parallel_risk_trial)) {
        assert(affected.size > 0, "请选择本次问题影响的软件包版本。");
      }
      assert([...affected].every((id) => items.some((item) => item.version_id === id)), "问题影响的软件包必须属于当前批次。");

      const timestamp = now();
      mkdirSync(join(process.cwd(), "data", "uploads", "reports"), { recursive: true });
      reportWritten = true;
      writeFileSync(absolutePath, bytes);
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
          if (item.parallel_risk_trial) {
            const reason = `${batch.code} ${batch.project_name} 集成测试发现该软件包版本存在问题：${input.testSummary.trim()}`;
            voidParallelRiskTrial(actor, item, reason, timestamp);
            voidedCount++;
          }
        }
        if (item.request_id === null) continue;
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
        refreshVersionAggregate(item.version_id);
        refreshTrialReadiness(item.version_id, timestamp);
      }
      audit(actor.id, "COMPLETE_BATCH", "BATCH", batchId, `提交 ${batch.code} 测试结论：${input.conclusion}，上传报告 ${file.name}`);
      return { voidedCount };
    });
  } catch (error) {
    if (reportWritten) rmSync(absolutePath, { force: true });
    throw error;
  }
}

function voidParallelRiskTrial(
  actor: SessionUser,
  item: { version_id: number; package_name: string; version: string },
  reason: string,
  timestamp: string,
) {
  run(
    `UPDATE package_versions SET status = 'VOID', void_kind = 'RISK_TEST_FAILURE', void_reason = ?,
       voided_at = ?, voided_by = ?, updated_at = ? WHERE id = ?`,
    reason, timestamp, actor.id, timestamp, item.version_id,
  );
  run(
    `UPDATE version_transfer_requests SET status = 'VOID', void_reason = ?, voided_at = ?, updated_at = ?
     WHERE package_version_id = ?`,
    reason, timestamp, timestamp, item.version_id,
  );
  run(
    `UPDATE binding_requirements SET status = 'CANCELLED', decision_reason = ?, updated_at = ?
     WHERE package_version_id = ? AND status IN ('PENDING','PASSED')`,
    reason, timestamp, item.version_id,
  );
  audit(actor.id, "VOID_RISK_TRIAL_TEST_FAILURE", "PACKAGE_VERSION", item.version_id, `作废 ${item.package_name} ${item.version} 风险试制。${reason}`);
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
    const [candidate] = getTrialReadyVersions([project.id], { requestId: input.requestId, includeUnregisteredRisk: true });
    assert(candidate && candidate.riskProjectCount > 0, "该版本已满足普通试制条件，或仍缺少共享试制所需的项目转测申请。");
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

export function releaseTrial(actor: SessionUser, requestId: number, trialFormNo: string, eligibility: string) {
  assert(trialFormNo.trim().length >= 3, "请填写发布试制电子流。");
  return transaction(() => {
    const anchor = one<{
      id: number;
      package_version_id: number;
      package_id: number;
      package_name: string;
      version: string;
      status: string;
    }>(
      `SELECT r.id, r.package_version_id, p.id AS package_id, p.name AS package_name, pv.version, pv.status
       FROM version_transfer_requests r
       JOIN package_versions pv ON pv.id = r.package_version_id
       JOIN packages p ON p.id = pv.package_id
       WHERE r.id = ?`,
      requestId,
    );
    assert(anchor, "项目版本记录不存在。", "NOT_FOUND");
    assert(["PENDING_TRANSFER", "IN_TEST", "PENDING_TRIAL"].includes(anchor.status), "该版本已结束待发布流程，不能重复发布试制。");

    const requests = all<{
      id: number;
      project_id: number;
      project_name: string;
      status: string;
    }>(
      `SELECT r.id, r.project_id, pr.name AS project_name, r.status
       FROM version_transfer_requests r
       JOIN projects pr ON pr.id = r.project_id
       WHERE r.package_version_id = ? AND pr.status != 'ARCHIVED'
         AND EXISTS (SELECT 1 FROM package_usages u WHERE u.package_id = ? AND u.project_id = r.project_id)
       ORDER BY pr.sort_order`,
      anchor.package_version_id, anchor.package_id,
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
        `${project.name} 缺少该版本的转测申请，不能发布共享试制。`,
      );
    }
    for (const request of requests) {
      assert(
        ["PENDING", "IN_TEST", "PASSED", "FAILED", "BLOCKED"].includes(request.status),
        `${request.project_name} 的版本状态不支持发布试制。`,
      );
    }
    const [ready] = getTrialReadyVersions(null, { requestId });
    assert(ready, "请先在待转测申请或集成测试页面登记风险试制原因。");
    assert(trialReleaseStateKey(ready) === eligibility, "试制资格已变化，请刷新后重新确认。");
    const riskRequired = ready.riskProjectCount > 0;
    const riskConclusion = riskRequired ? ready.riskConclusion : null;

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

    const timestamp = now();
    run(
      `UPDATE package_versions
       SET status = 'TRIAL', trial_form_no = ?, trial_released_at = ?, release_mode = ?,
           risk_conclusion = ?, binding_mode = 'PENDING', binding_reason = NULL,
           binding_decided_at = NULL, binding_decided_by = NULL, updated_at = ?
       WHERE id = ?`,
      trialFormNo.trim(),
      timestamp,
      riskRequired ? "RISK" : "INTEGRATION",
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
        trialFormNo.trim(),
        timestamp,
        actor.id,
        riskRequired ? "RISK" : "INTEGRATION",
        riskConclusion ?? null,
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

function assertVersionProjectManager(actor: SessionUser, versionId: number) {
  const requests = all<{ project_id: number }>(
    `SELECT r.project_id FROM version_transfer_requests r
     JOIN package_versions pv ON pv.id = r.package_version_id
     JOIN projects pr ON pr.id = r.project_id
     WHERE r.package_version_id = ? AND pr.status != 'ARCHIVED'
       AND CASE WHEN pv.status IN ('TRIAL','PENDING_FORMAL','FORMAL')
         THEN r.trial_released_at IS NOT NULL OR r.formal_released_at IS NOT NULL
         ELSE EXISTS (SELECT 1 FROM package_usages u WHERE u.package_id = pv.package_id AND u.project_id = r.project_id)
       END`,
    versionId,
  );
  if (requests.length === 0) {
    assert(actor.role === "ADMIN", "该版本没有可操作的项目记录。", "NOT_FOUND");
    return;
  }
  assert(
    requests.some((request) => canManageProjectWorkflowForProject(actor, request.project_id)),
    "只有使用该软件包的项目软件经理或系统管理员可以执行该操作。",
    "FORBIDDEN",
  );
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
    const enteredFormal = refreshTrialReadiness(anchor.package_version_id, timestamp);
    audit(actor.id, "SKIP_BINDING", "PACKAGE_VERSION", anchor.package_version_id, `跳过 ${anchor.package_name} ${anchor.version} 绑定验证：${reason.trim()}`);
    return { enteredFormal };
  });
}

export function waiveBindingRequirement(actor: SessionUser, requirementId: number, reason: string) {
  assert(reason.trim().length >= 5, "请填写此节点无需绑定的原因（至少 5 个字符）。");
  return transaction(() => {
    const requirement = one<{
      request_id: number;
      package_version_id: number;
      project_id: number;
      node_name: string;
      status: string;
      request_status: string;
      binding_owner_id: number | null;
      pushed_at: string | null;
    }>(
      `SELECT br.request_id, br.package_version_id, br.project_id, n.name AS node_name,
              br.status, r.status AS request_status, br.binding_owner_id, br.pushed_at
       FROM binding_requirements br
       JOIN version_transfer_requests r ON r.id = br.request_id
       JOIN project_nodes n ON n.id = br.node_id WHERE br.id = ?`,
      requirementId,
    );
    assert(requirement, "绑定任务不存在。", "NOT_FOUND");
    assert(
      canManageProjectWorkflowForProject(actor, requirement.project_id) || requirement.binding_owner_id === actor.id,
      "只有本项目软件经理、该节点绑定责任人或管理员可以登记无需绑定。",
      "FORBIDDEN",
    );
    assert(requirement.pushed_at, "请先确认并推送绑定任务，再处理节点绑定。");
    assert(requirement.request_status === "TRIAL" && requirement.status === "PENDING", "只有待绑定节点可以登记无需绑定。");
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
    const enteredFormal = refreshTrialReadiness(requirement.package_version_id, timestamp);
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
    const [ready] = getTrialReadyVersions(null, { requestId });
    assert(ready, "试制资格已变化，请刷新后重新确认。");
    assertProjectManager(actor, ready.projectId);
    assert(trialReleaseStateKey(ready) === eligibility, "试制资格已变化，请刷新后重新确认。");
    const timestamp = now();
    if (ready.riskProjectCount > 0) {
      run("UPDATE trial_risk_admissions SET invalidated_at = ? WHERE package_version_id = ? AND invalidated_at IS NULL",
        timestamp, anchor.package_version_id);
      audit(actor.id, "WITHDRAW_RISK_TRIAL", "PACKAGE_VERSION", anchor.package_version_id, conclusion.trim());
      return { withdrawnRisk: true };
    }
    run(
      `UPDATE package_versions SET status = 'VOID', void_kind = 'ABANDON', void_reason = ?, voided_at = ?, voided_by = ?, updated_at = ? WHERE id = ?`,
      `放弃发布试制：${conclusion.trim()}`,
      timestamp,
      actor.id,
      timestamp,
      anchor.package_version_id,
    );
    run(
      "UPDATE version_transfer_requests SET status = 'VOID', void_reason = ?, voided_at = ?, updated_at = ? WHERE package_version_id = ?",
      `放弃发布试制：${conclusion.trim()}`,
      timestamp,
      timestamp,
      anchor.package_version_id,
    );
    audit(actor.id, "ABANDON_TRIAL_RELEASE", "PACKAGE_VERSION", anchor.package_version_id, `放弃发布 ${anchor.package_name} ${anchor.version} 试制：${conclusion.trim()}`);
    return { withdrawnRisk: false };
  });
}

export function voidPackageVersion(actor: SessionUser, versionId: number, reason: string) {
  assert(reason.trim().length >= 5, "请填写作废原因。");
  return transaction(() => {
    const version = one<{ id: number; status: string; package_id: number; package_name: string; version: string }>(
      `SELECT pv.id, pv.status, p.id AS package_id, p.name AS package_name, pv.version
       FROM package_versions pv JOIN packages p ON p.id = pv.package_id WHERE pv.id = ?`,
      versionId,
    );
    assert(version, "软件包版本不存在。", "NOT_FOUND");
    assertVersionProjectManager(actor, versionId);
    assert(
      ["TRIAL", "PENDING_FORMAL", "FORMAL", "PENDING_TRIAL"].includes(version.status),
      "当前版本状态不支持作废。",
    );
    const voidKind = version.status === "FORMAL" ? "FORMAL" : version.status === "PENDING_TRIAL" ? "ABANDON" : "TRIAL";
    const timestamp = now();
    run(
      `UPDATE package_versions SET status = 'VOID', void_kind = ?, void_reason = ?, voided_at = ?, voided_by = ?, updated_at = ? WHERE id = ?`,
      voidKind,
      reason.trim(),
      timestamp,
      actor.id,
      timestamp,
      versionId,
    );
    run(
      "UPDATE version_transfer_requests SET status = 'VOID', void_reason = ?, voided_at = ?, updated_at = ? WHERE package_version_id = ?",
      reason.trim(),
      timestamp,
      timestamp,
      versionId,
    );
    audit(actor.id, "VOID_VERSION", "PACKAGE_VERSION", versionId, `作废 ${version.package_name} ${version.version} 版本：${reason.trim()}`);
  });
}

export function voidTrial(actor: SessionUser, requestId: number, reason: string) {
  assert(reason.trim().length >= 5, "请填写作废原因。");
  return transaction(() => {
    const anchor = one<{
      id: number;
      package_version_id: number;
      package_id: number;
      package_name: string;
      version: string;
      binding_mode: string;
    }>(
      `SELECT r.id, r.package_version_id, p.id AS package_id, p.name AS package_name, pv.version, pv.binding_mode
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
    const timestamp = now();
    run(
      "UPDATE package_versions SET status = 'VOID', void_kind = 'TRIAL', void_reason = ?, voided_at = ?, voided_by = ?, updated_at = ? WHERE id = ?",
      reason.trim(),
      timestamp,
      actor.id,
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
  return transaction(() => {
    const requirement = one<{
      id: number;
      request_id: number;
      request_status: string;
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
    }>(
      `SELECT br.id, br.request_id, r.status AS request_status, br.status, br.package_version_id, p.id AS package_id,
              p.name AS package_name, pv.version, br.binding_owner_id, br.approver_id, br.project_id,
              pr.name AS project_name, br.node_id, n.name AS node_name, br.pushed_at
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
    assert(requirement.status === "PENDING", "该节点的绑定要求已处理。");
    assert(requirement.pushed_at, "软件经理尚未推送绑定任务，暂不能提交绑定电子流。");
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
  return transaction(() => {
    const flow = one<{ submitted_by: number | null; status: string; project_id: number; void_kind: string | null }>(
      `SELECT f.submitted_by, f.status, f.project_id, pv.void_kind
       FROM binding_flows f JOIN package_versions pv ON pv.id = f.package_version_id WHERE f.id = ?`,
      flowId,
    );
    assert(flow, "绑定电子流不存在。", "NOT_FOUND");
    assert(
      flow.status === "PENDING" || (flow.status === "APPROVED" && flow.void_kind === "RISK_TEST_FAILURE"),
      "只能撤销待审批的绑定电子流，或因并行集成测试而作废的已通过绑定电子流。",
    );
    assert(
      flow.submitted_by === actor.id || canManageProjectWorkflowForProject(actor, flow.project_id),
      "只有提交人、本项目软件经理或管理员可以撤销绑定电子流。",
      "FORBIDDEN",
    );
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
  return transaction(() => {
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
      const requirement = one<{ required_count: number }>("SELECT required_count FROM binding_requirements WHERE id = ?", flow.requirement_id);
      const counts = one<{ approved: number }>(
        `SELECT COUNT(*) AS approved FROM binding_flow_barcodes b
         JOIN binding_flows f ON f.id = b.flow_id
         WHERE f.requirement_id = ? AND f.status = 'APPROVED'`,
        flow.requirement_id,
      );
      const approvedCount = Number(counts?.approved ?? 0);
      if (requirement && approvedCount >= requirement.required_count) {
        run("UPDATE binding_requirements SET status = 'PASSED', updated_at = ? WHERE id = ?", timestamp, flow.requirement_id);
        run(
          `UPDATE binding_flows SET status = 'CANCELLED', cancelled_at = ?,
             cancel_reason = '该节点绑定通过数量已满足，系统关闭剩余电子流'
           WHERE requirement_id = ? AND status = 'PENDING'`,
          timestamp, flow.requirement_id,
        );
        enteredFormal = refreshTrialReadiness(flow.version_id, timestamp);
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
  return transaction(() => {
    const anchor = one<{
      id: number;
      package_version_id: number;
      package_id: number;
      package_name: string;
      version: string;
      binding_mode: string;
    }>(
      `SELECT r.id, r.package_version_id, p.id AS package_id, p.name AS package_name, pv.version, pv.binding_mode
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
       WHERE r.package_version_id = ? AND pr.status != 'ARCHIVED' AND r.trial_released_at IS NOT NULL
       ORDER BY pr.sort_order`,
      anchor.package_version_id,
    );
    assert(requests.some((request) => request.id === requestId), "该项目没有可转正的试制记录。", "NOT_FOUND");
    assert(
      requests.some((request) => canManageProjectWorkflowForProject(actor, request.project_id)),
      "只有使用该软件包的项目软件经理或系统管理员可以发布转正。",
      "FORBIDDEN",
    );
    assert(!hasActiveIntegrationBatch(anchor.package_version_id), "该软件包仍有关联转测批次待发起或在测，不能转正。");
    for (const request of requests) {
      assert(request.status === "PENDING_FORMAL", `${request.project_name} 尚未完成全部项目绑定验证，不能转正。`);
    }
    const summary = one<{ total: number; settled: number; cancelled: number }>(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN br.status = 'PASSED' OR (br.status = 'CANCELLED' AND br.waived_at IS NOT NULL) THEN 1 ELSE 0 END) AS settled,
              SUM(CASE WHEN br.status = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled
       FROM binding_requirements br
       JOIN version_transfer_requests r ON r.id = br.request_id
       WHERE r.package_version_id = ?`,
      anchor.package_version_id,
    );
    const total = Number(summary?.total ?? 0);
    const settled = Number(summary?.settled ?? 0);
    const cancelled = Number(summary?.cancelled ?? 0);
    if (anchor.binding_mode === "SKIPPED") {
      assert(cancelled === total, "该版本已标记无需绑定，但仍存在未关闭的绑定要求。");
    } else {
      assert(total > 0 && settled === total, "该软件包仍有未处理的节点绑定要求，不能转正。");
    }
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
    return anchor.package_version_id;
  });
}
