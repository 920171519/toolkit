import "server-only";

import { assertVersionProjectManager, canSubmitTransferForArea } from "./access";
import { createAuditLogWriter } from "./audit-log";
import { db, one, run, transaction } from "./db";
import { assert, DomainError } from "./domain-error";
import { invalidTransferFields, TRANSFER_CHANGE_SUMMARY_MIN_LENGTH, type TransferFormFields } from "./transfer-form-validation";
import { insertTransferRequest } from "./transfer-request-writes";
import { getActiveTransferProjects } from "./transfer-requests";
import type { SessionUser } from "./types";

const audit = createAuditLogWriter(db);
const now = () => new Date().toISOString();

const transferFieldErrors: Record<keyof TransferFormFields, string> = {
  version: "请填写版本号。",
  changeSummary: `请填写版本变更说明（至少 ${TRANSFER_CHANGE_SUMMARY_MIN_LENGTH} 个字符）。`,
  archiveUrl: "归档链接必须以 http:// 或 https:// 开头。",
  buildUrl: "构建地址必须以 http:// 或 https:// 开头。",
};

export function submitTransfer(actor: SessionUser, input: TransferFormFields & { packageId: number; scopeProjectId?: number }) {
  const [invalidField] = invalidTransferFields(input);
  if (invalidField) throw new DomainError(transferFieldErrors[invalidField]);

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
