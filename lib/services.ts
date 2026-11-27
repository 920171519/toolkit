import { all, one, run, transaction } from "./db";
import type {
  BatchConclusion,
  IssueAttribution,
  PackageStatus,
} from "./constants";
import type { SessionUser } from "./types";

export class DomainError extends Error {
  code: string;
  constructor(message: string, code = "DOMAIN_ERROR") {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}

export function assert(condition: unknown, message: string, code = "DOMAIN_ERROR"): asserts condition {
  if (!condition) throw new DomainError(message, code);
}

// Historical workflow predicates. Live workflows use the assignment checks in access.ts.
function canManageWorkflow(user: SessionUser) {
  return ["ADMIN", "SOFTWARE_MANAGER"].includes(user.role);
}

function canReview(user: SessionUser) {
  return ["ADMIN", "REVIEWER"].includes(user.role);
}

function canApproveReview(user: SessionUser, requestedById: number | null) {
  return canReview(user) && user.id !== requestedById;
}

function canSubmitForPackage(user: SessionUser, ownerId: number | null) {
  return canManageWorkflow(user) || user.id === ownerId;
}

function canValidateBinding(user: SessionUser) {
  return ["ADMIN", "SOFTWARE_MANAGER", "INTEGRATION_TESTER", "TEST_VALIDATOR", "PACKAGE_OWNER"].includes(user.role);
}

function audit(
  actorId: number,
  action: string,
  entityType: string,
  entityId: number | null,
  detail: string,
) {
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

function now() {
  return new Date().toISOString();
}

export type SubmitTransferInput = {
  packageId: number;
  version: string;
  changeSummary: string;
  archiveUrl: string;
};

export function submitTransfer(actor: SessionUser, input: SubmitTransferInput): number {
  const pkg = one<{ id: number; name: string; owner_id: number | null; is_active: number }>(
    "SELECT id, name, owner_id, is_active FROM packages WHERE id = ?",
    input.packageId,
  );
  assert(pkg, "软件包不存在。", "NOT_FOUND");
  assert(pkg.is_active === 1, "该软件包已停用，不能提交转测申请。");
  assert(
    canSubmitForPackage(actor, pkg.owner_id),
    "只有该软件包的责任人或软件经理可以提交转测申请。",
    "FORBIDDEN",
  );
  assert(input.version.trim().length > 0, "请填写版本号。");
  assert(input.changeSummary.trim().length >= 5, "请填写版本变更说明（至少 5 个字符）。");
  assert(/^https?:\/\//i.test(input.archiveUrl.trim()), "归档链接必须以 http:// 或 https:// 开头。");

  const activeVersion = one<{ id: number; version: string; status: PackageStatus }>(
    "SELECT id, version, status FROM package_versions WHERE package_id = ? AND status != 'FORMAL' LIMIT 1",
    input.packageId,
  );
  assert(
    !activeVersion,
    `该软件包已有在途版本 ${activeVersion?.version ?? ""}，需完成当前流程后才能提交新版本。`,
  );
  const duplicate = one<{ id: number }>(
    "SELECT id FROM package_versions WHERE package_id = ? AND LOWER(version) = LOWER(?)",
    input.packageId,
    input.version.trim(),
  );
  assert(!duplicate, "该版本号已存在，请填写新的版本号。");

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
    const id = Number(result.lastInsertRowid);
    audit(
      actor.id,
      "SUBMIT_TRANSFER",
      "PACKAGE",
      pkg.id,
      `提交 ${pkg.name} ${input.version.trim()} 转测申请`,
    );
    return id;
  });
}

export function cancelTransfer(actor: SessionUser, versionId: number): void {
  const version = one<{
    id: number;
    package_id: number;
    package_name: string;
    version: string;
    status: PackageStatus;
    submitted_by: number | null;
  }>(
    `SELECT pv.id, pv.package_id, p.name AS package_name, pv.version, pv.status, pv.submitted_by
     FROM package_versions pv JOIN packages p ON p.id = pv.package_id WHERE pv.id = ?`,
    versionId,
  );
  assert(version, "转测申请不存在。", "NOT_FOUND");
  assert(version.status === "PENDING_TRANSFER", "只有待转测的申请可以撤回。");
  assert(
    canManageWorkflow(actor) || version.submitted_by === actor.id,
    "只有申请人或软件经理可以撤回转测申请。",
    "FORBIDDEN",
  );
  const draftReference = one<{ id: number }>(
    `SELECT b.id FROM batch_items bi JOIN integration_batches b ON b.id = bi.batch_id
     WHERE bi.package_version_id = ? AND b.status = 'DRAFT' LIMIT 1`,
    versionId,
  );
  assert(!draftReference, "该申请已被待发起的转测批次引用，请先删除草稿批次。");
  transaction(() => {
    run("DELETE FROM package_versions WHERE id = ?", versionId);
    audit(
      actor.id,
      "CANCEL_TRANSFER",
      "PACKAGE",
      version.package_id,
      `撤回 ${version.package_name} ${version.version} 转测申请`,
    );
  });
}

export type BatchDraftInput = {
  code: string;
  title: string;
  items: Array<{ packageId: number; packageVersionId: number }>;
};

export function createBatchDraft(actor: SessionUser, input: BatchDraftInput): number {
  assert(canManageWorkflow(actor), "只有软件经理或系统管理员可以组织转测。", "FORBIDDEN");
  const code = input.code.trim().toUpperCase();
  assert(/^B\d{3,}$/.test(code), "批次号格式应为 B 加至少 3 位数字，例如 B121。");
  assert(input.items.length > 0, "请至少选择一个参与转测的软件包。");
  const duplicatePackage = new Set<number>();
  let changedCount = 0;
  const normalizedItems = input.items.map((item) => {
    assert(!duplicatePackage.has(item.packageId), "同一个软件包不能在批次中重复出现。");
    duplicatePackage.add(item.packageId);
    const version = one<{
      id: number;
      package_id: number;
      package_name: string;
      version: string;
      archive_url: string;
      change_summary: string;
      status: PackageStatus;
      is_active: number;
    }>(
      `SELECT pv.id, pv.package_id, p.name AS package_name, pv.version, pv.archive_url,
              pv.change_summary, pv.status, p.is_active
       FROM package_versions pv JOIN packages p ON p.id = pv.package_id WHERE pv.id = ?`,
      item.packageVersionId,
    );
    assert(version, "选择的软件包版本不存在。", "NOT_FOUND");
    assert(version.package_id === item.packageId, "软件包与版本不匹配。");
    assert(version.is_active === 1, `${version.package_name} 已停用，不能参与转测。`);
    assert(
      version.status === "FORMAL" || version.status === "PENDING_TRANSFER",
      `${version.package_name} ${version.version} 当前状态不能加入新的转测批次，请选择正式版本或待转测版本。`,
    );
    if (version.status === "PENDING_TRANSFER") changedCount += 1;
    return {
      ...version,
      isChanged: version.status === "PENDING_TRANSFER",
    };
  });
  assert(changedCount > 0, "转测批次中至少需要一个待转测的新版本。");
  const existingCode = one<{ id: number }>(
    "SELECT id FROM integration_batches WHERE UPPER(code) = ?",
    code,
  );
  assert(!existingCode, `批次号 ${code} 已存在，请更换批次号。`);

  return transaction(() => {
    const timestamp = now();
    const result = run(
      `INSERT INTO integration_batches (code, title, status, created_by, created_at)
       VALUES (?, ?, 'DRAFT', ?, ?)`,
      code,
      input.title.trim() || `${code} 配套转测`,
      actor.id,
      timestamp,
    );
    const batchId = Number(result.lastInsertRowid);
    for (const item of normalizedItems) {
      run(
        `INSERT INTO batch_items
          (batch_id, package_id, package_version_id, version, archive_url, change_summary, is_changed)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        batchId,
        item.package_id,
        item.id,
        item.version,
        item.archive_url,
        item.change_summary,
        item.isChanged ? 1 : 0,
      );
    }
    audit(
      actor.id,
      "CREATE_BATCH",
      "BATCH",
      batchId,
      `创建 ${code} 转测批次，共 ${normalizedItems.length} 个软件包，${changedCount} 个版本更新`,
    );
    return batchId;
  });
}

export function deleteDraftBatch(actor: SessionUser, batchId: number): void {
  assert(canManageWorkflow(actor), "只有软件经理或系统管理员可以删除转测草稿。", "FORBIDDEN");
  const batch = one<{ id: number; code: string; status: string }>(
    "SELECT id, code, status FROM integration_batches WHERE id = ?",
    batchId,
  );
  assert(batch, "转测批次不存在。", "NOT_FOUND");
  assert(batch.status === "DRAFT", "只有待发起的草稿批次可以删除。");
  transaction(() => {
    run("DELETE FROM integration_batches WHERE id = ?", batchId);
    audit(actor.id, "DELETE_BATCH_DRAFT", "BATCH", batchId, `删除 ${batch.code} 转测草稿`);
  });
}

export function sendBatch(actor: SessionUser, batchId: number): void {
  assert(canManageWorkflow(actor), "只有软件经理或系统管理员可以发起转测。", "FORBIDDEN");
  const batch = one<{ id: number; code: string; status: string; title: string }>(
    "SELECT id, code, status, title FROM integration_batches WHERE id = ?",
    batchId,
  );
  assert(batch, "转测批次不存在。", "NOT_FOUND");
  assert(batch.status === "DRAFT", "该批次已不是待发起状态。");
  const activeBatch = one<{ id: number; code: string }>(
    "SELECT id, code FROM integration_batches WHERE status = 'IN_TEST' LIMIT 1",
  );
  assert(
    !activeBatch,
    `当前 ${activeBatch?.code ?? "上一批次"} 仍在集成测试中，请先填写原因终止上一轮测试，再发起新批次。`,
  );
  const items = all<{
    id: number;
    package_version_id: number;
    package_name: string;
    version: string;
    is_changed: number;
    status: PackageStatus;
  }>(
    `SELECT bi.id, bi.package_version_id, p.name AS package_name, bi.version, bi.is_changed, pv.status
     FROM batch_items bi
     JOIN packages p ON p.id = bi.package_id
     JOIN package_versions pv ON pv.id = bi.package_version_id
     WHERE bi.batch_id = ?`,
    batchId,
  );
  assert(items.length > 0, "批次中没有软件包，无法发起转测。");
  const changed = items.filter((item) => item.is_changed === 1);
  assert(changed.length > 0, "批次中没有待转测的新版本，无法发起转测。");
  for (const item of changed) {
    assert(
      item.status === "PENDING_TRANSFER",
      `${item.package_name} ${item.version} 已不在待转测状态，请重新创建批次。`,
    );
  }
  transaction(() => {
    const timestamp = now();
    run("UPDATE integration_batches SET status = 'IN_TEST', sent_at = ? WHERE id = ?", timestamp, batchId);
    for (const item of changed) {
      run(
        "UPDATE package_versions SET status = 'IN_TEST', updated_at = ? WHERE id = ?",
        timestamp,
        item.package_version_id,
      );
    }
    audit(
      actor.id,
      "SEND_BATCH",
      "BATCH",
      batchId,
      `发起 ${batch.code} 配套转测，包含 ${items.length} 个软件包，其中 ${changed.length} 个版本更新`,
    );
  });
}

export function terminateBatch(actor: SessionUser, batchId: number, reason: string) {
  assert(canManageWorkflow(actor), "只有软件经理或系统管理员可以终止转测。", "FORBIDDEN");
  assert(reason.trim().length >= 4, "请填写终止原因（至少 4 个字符）。");
  const batch = one<{ id: number; code: string; status: string }>(
    "SELECT id, code, status FROM integration_batches WHERE id = ?",
    batchId,
  );
  assert(batch, "转测批次不存在。", "NOT_FOUND");
  assert(batch.status === "IN_TEST", "只有集成测试中的批次可以终止。");
  const items = all<{ id: number; package_version_id: number; package_name: string; version: string }>(
    `SELECT bi.id, bi.package_version_id, p.name AS package_name, bi.version
     FROM batch_items bi JOIN packages p ON p.id = bi.package_id
     WHERE bi.batch_id = ? AND bi.is_changed = 1`,
    batchId,
  );
  transaction(() => {
    const timestamp = now();
    run(
      "UPDATE integration_batches SET status = 'TERMINATED', terminated_at = ?, terminate_reason = ? WHERE id = ?",
      timestamp,
      reason.trim(),
      batchId,
    );
    for (const item of items) {
      run(
        `UPDATE package_versions SET status = 'PENDING_TRANSFER', updated_at = ?
         WHERE id = ? AND status = 'IN_TEST'`,
        timestamp,
        item.package_version_id,
      );
    }
    audit(
      actor.id,
      "TERMINATE_BATCH",
      "BATCH",
      batchId,
      `终止 ${batch.code} 集成测试：${reason.trim()}`,
    );
  });
}

export type CompleteBatchInput = {
  conclusion: BatchConclusion;
  issueAttribution: IssueAttribution;
  testSummary: string;
  testReportUrl: string;
};

export function completeBatchTest(actor: SessionUser, batchId: number, input: CompleteBatchInput) {
  assert(
    ["ADMIN", "SOFTWARE_MANAGER", "INTEGRATION_TESTER"].includes(actor.role),
    "只有集成测试人员或管理人员可以提交测试结论。",
    "FORBIDDEN",
  );
  const batch = one<{ id: number; code: string; status: string }>(
    "SELECT id, code, status FROM integration_batches WHERE id = ?",
    batchId,
  );
  assert(batch, "转测批次不存在。", "NOT_FOUND");
  assert(batch.status === "IN_TEST", "只有集成测试中的批次可以提交测试结论。");
  assert(input.testSummary.trim().length >= 10, "请填写测试总结（至少 10 个字符）。");
  assert(/^https?:\/\//i.test(input.testReportUrl.trim()), "测试报告链接必须以 http:// 或 https:// 开头。");
  if (input.conclusion === "PASS") {
    assert(input.issueAttribution === "NONE", "测试通过时问题归属应为“未发现问题”。");
  } else if (input.conclusion === "FAIL") {
    assert(
      input.issueAttribution === "PACKAGE_RELATED" || input.issueAttribution === "NOT_PACKAGE_RELATED",
      "测试不通过时，需要判断问题是否与软件包相关。",
    );
  } else {
    assert(input.issueAttribution === "UNKNOWN", "无法完成验证时，问题归属应为“原因待定位”。");
  }
  const changed = all<{ package_version_id: number; package_name: string; version: string }>(
    `SELECT bi.package_version_id, p.name AS package_name, bi.version
     FROM batch_items bi JOIN packages p ON p.id = bi.package_id
     WHERE bi.batch_id = ? AND bi.is_changed = 1`,
    batchId,
  );
  assert(changed.length > 0, "批次中没有变更包。");
  transaction(() => {
    const timestamp = now();
    run(
      `UPDATE integration_batches
       SET status = 'COMPLETED', completed_at = ?, conclusion = ?, issue_attribution = ?,
           test_summary = ?, test_report_url = ?
       WHERE id = ?`,
      timestamp,
      input.conclusion,
      input.issueAttribution,
      input.testSummary.trim(),
      input.testReportUrl.trim(),
      batchId,
    );
    for (const item of changed) {
      run(
        `UPDATE package_versions SET status = 'PENDING_TRIAL', updated_at = ?
         WHERE id = ? AND status = 'IN_TEST'`,
        timestamp,
        item.package_version_id,
      );
    }
    audit(
      actor.id,
      "COMPLETE_BATCH",
      "BATCH",
      batchId,
      `提交 ${batch.code} 测试结论：${input.conclusion === "PASS" ? "通过" : input.conclusion === "FAIL" ? "不通过" : "无法完成验证"}，${changed.length} 个变更包进入待发试制`,
    );
  });
}

export function createRiskReview(actor: SessionUser, packageVersionId: number, batchId: number, reason: string) {
  assert(canManageWorkflow(actor), "只有软件经理或系统管理员可以发起风险评审。", "FORBIDDEN");
  assert(reason.trim().length >= 10, "请填写风险评审原因（至少 10 个字符）。");
  const version = one<{
    id: number;
    package_id: number;
    package_name: string;
    version: string;
    status: PackageStatus;
  }>(
    `SELECT pv.id, pv.package_id, p.name AS package_name, pv.version, pv.status
     FROM package_versions pv JOIN packages p ON p.id = pv.package_id WHERE pv.id = ?`,
    packageVersionId,
  );
  assert(version, "软件包版本不存在。", "NOT_FOUND");
  assert(version.status === "PENDING_TRIAL", "只有待发试制的版本可以发起风险评审。");
  const batch = one<{
    id: number;
    code: string;
    status: string;
    conclusion: BatchConclusion | null;
  }>(
    "SELECT id, code, status, conclusion FROM integration_batches WHERE id = ?",
    batchId,
  );
  assert(batch, "关联的测试批次不存在。", "NOT_FOUND");
  assert(batch.status === "COMPLETED", "测试批次尚未完成，不能发起风险评审。");
  assert(batch.conclusion !== "PASS", "测试通过的版本无需风险评审。");
  const item = one<{ id: number }>(
    "SELECT id FROM batch_items WHERE batch_id = ? AND package_version_id = ? AND is_changed = 1",
    batchId,
    packageVersionId,
  );
  assert(item, "该版本不属于此批次的变更包。");
  const latest = one<{ id: number; status: string }>(
    "SELECT id, status FROM risk_reviews WHERE package_version_id = ? AND batch_id = ? ORDER BY id DESC LIMIT 1",
    packageVersionId,
    batchId,
  );
  assert(
    !latest || latest.status === "REJECTED",
    latest?.status === "APPROVED" ? "该版本风险评审已通过。" : "该版本已有进行中的风险评审。",
  );
  return transaction(() => {
    const timestamp = now();
    const result = run(
      `INSERT INTO risk_reviews
        (batch_id, package_version_id, reason, status, requested_by, created_at)
       VALUES (?, ?, ?, 'PENDING', ?, ?)`,
      batchId,
      packageVersionId,
      reason.trim(),
      actor.id,
      timestamp,
    );
    const id = Number(result.lastInsertRowid);
    audit(
      actor.id,
      "CREATE_RISK_REVIEW",
      "RISK_REVIEW",
      id,
      `为 ${version.package_name} ${version.version} 发起风险评审（${batch.code}）`,
    );
    return id;
  });
}

export function decideRiskReview(
  actor: SessionUser,
  reviewId: number,
  decision: "APPROVED" | "REJECTED",
  conclusion: string,
) {
  assert(canReview(actor), "只有评审专家或系统管理员可以给出风险评审结论。", "FORBIDDEN");
  assert(conclusion.trim().length >= 4, "请填写评审结论（至少 4 个字符）。");
  const review = one<{
    id: number;
    status: string;
    requested_by: number | null;
    package_name: string;
    version: string;
    batch_code: string;
  }>(
    `SELECT rr.id, rr.status, rr.requested_by, p.name AS package_name, pv.version, b.code AS batch_code
     FROM risk_reviews rr
     JOIN package_versions pv ON pv.id = rr.package_version_id
     JOIN packages p ON p.id = pv.package_id
     JOIN integration_batches b ON b.id = rr.batch_id
     WHERE rr.id = ?`,
    reviewId,
  );
  assert(review, "风险评审不存在。", "NOT_FOUND");
  assert(review.status === "PENDING", "该风险评审已处理。");
  assert(canApproveReview(actor, review.requested_by), "不能评审自己发起的风险申请。", "FORBIDDEN");
  transaction(() => {
    run(
      `UPDATE risk_reviews SET status = ?, conclusion = ?, reviewed_by = ?, reviewed_at = ?
       WHERE id = ?`,
      decision,
      conclusion.trim(),
      actor.id,
      now(),
      reviewId,
    );
    audit(
      actor.id,
      "DECIDE_RISK_REVIEW",
      "RISK_REVIEW",
      reviewId,
      `${review.package_name} ${review.version}（${review.batch_code}）风险评审${decision === "APPROVED" ? "通过" : "驳回"}：${conclusion.trim()}`,
    );
  });
}

export function releaseTrial(actor: SessionUser, versionId: number): number {
  assert(canManageWorkflow(actor), "只有软件经理或系统管理员可以发布试制版本。", "FORBIDDEN");
  const version = one<{
    id: number;
    package_id: number;
    package_name: string;
    version: string;
    status: PackageStatus;
    batch_id: number | null;
    batch_code: string | null;
    conclusion: BatchConclusion | null;
  }>(
    `SELECT pv.id, pv.package_id, p.name AS package_name, pv.version, pv.status,
            b.id AS batch_id, b.code AS batch_code, b.conclusion
     FROM package_versions pv
     JOIN packages p ON p.id = pv.package_id
     LEFT JOIN batch_items bi ON bi.id = (
       SELECT bi2.id FROM batch_items bi2 WHERE bi2.package_version_id = pv.id ORDER BY bi2.id DESC LIMIT 1
     )
     LEFT JOIN integration_batches b ON b.id = bi.batch_id
     WHERE pv.id = ?`,
    versionId,
  );
  assert(version, "软件包版本不存在。", "NOT_FOUND");
  assert(version.status === "PENDING_TRIAL", "只有待发试制的版本可以发布试制。");
  assert(version.batch_id && version.conclusion, "该版本缺少已完成的测试批次信息。");
  const usages = all<{ project_id: number; node_id: number }>(
    `SELECT u.project_id, u.node_id
     FROM package_usages u
     JOIN projects pr ON pr.id = u.project_id
     WHERE u.package_id = ? AND pr.status != 'ARCHIVED'`,
    version.package_id,
  );
  assert(
    usages.length > 0,
    "该软件包尚未配置任何在行项目的测试节点，无法生成完整的绑定验证覆盖，请先完善软件包使用范围。",
  );
  transaction(() => {
    const timestamp = now();
    run(
      "UPDATE package_versions SET status = 'TRIAL', trial_released_at = ?, updated_at = ? WHERE id = ?",
      timestamp,
      timestamp,
      versionId,
    );
    for (const usage of usages) {
      run(
        `INSERT OR IGNORE INTO binding_tasks (package_version_id, project_id, node_id, status)
         VALUES (?, ?, ?, 'PENDING')`,
        versionId,
        usage.project_id,
        usage.node_id,
      );
    }
    audit(
      actor.id,
      "RELEASE_TRIAL",
      "PACKAGE",
      version.package_id,
      `发布 ${version.package_name} ${version.version} 试制版本，生成 ${usages.length} 个绑定验证节点任务`,
    );
  });
  return usages.length;
}

export function updateBindingTask(
  actor: SessionUser,
  taskId: number,
  status: "PENDING" | "PASSED" | "FAILED",
  note: string,
) {
  assert(canValidateBinding(actor), "当前角色无权记录绑定验证结果。", "FORBIDDEN");
  const task = one<{
    id: number;
    package_version_id: number;
    package_name: string;
    package_id: number;
    version: string;
    version_status: PackageStatus;
    project_name: string;
    node_name: string;
  }>(
    `SELECT bt.id, bt.package_version_id, p.name AS package_name, pv.package_id, pv.version,
            pv.status AS version_status, pr.name AS project_name, n.name AS node_name
     FROM binding_tasks bt
     JOIN package_versions pv ON pv.id = bt.package_version_id
     JOIN packages p ON p.id = pv.package_id
     JOIN projects pr ON pr.id = bt.project_id
     JOIN project_nodes n ON n.id = bt.node_id
     WHERE bt.id = ?`,
    taskId,
  );
  assert(task, "绑定验证任务不存在。", "NOT_FOUND");
  assert(task.version_status === "TRIAL", "该版本已完成绑定验证，不能再修改节点结果。");
  const trimmedNote = note.trim();
  if (status === "PASSED") assert(trimmedNote.length >= 2, "验证通过时请填写验证说明。");
  if (status === "FAILED") assert(trimmedNote.length >= 4, "验证不通过时请填写问题说明。");
  transaction(() => {
    const timestamp = now();
    run(
      `UPDATE binding_tasks
       SET status = ?, note = ?, validated_by = ?, validated_at = ?
       WHERE id = ?`,
      status,
      trimmedNote,
      status === "PENDING" ? null : actor.id,
      status === "PENDING" ? null : timestamp,
      taskId,
    );
    const counts = one<{ total: number; passed: number }>(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'PASSED' THEN 1 ELSE 0 END) AS passed
       FROM binding_tasks WHERE package_version_id = ?`,
      task.package_version_id,
    );
    const total = Number(counts?.total ?? 0);
    const passed = Number(counts?.passed ?? 0);
    if (total > 0 && passed === total) {
      run(
        "UPDATE package_versions SET status = 'PENDING_FORMAL', updated_at = ? WHERE id = ? AND status = 'TRIAL'",
        timestamp,
        task.package_version_id,
      );
      audit(
        actor.id,
        "BINDING_COMPLETE",
        "PACKAGE",
        task.package_id,
        `${task.package_name} ${task.version} 已完成全部 ${total} 个项目节点绑定验证，进入待转正`,
      );
    }
    audit(
      actor.id,
      "UPDATE_BINDING_TASK",
      "PACKAGE",
      task.package_id,
      `记录 ${task.package_name} ${task.version} 在 ${task.project_name} / ${task.node_name} 的绑定验证：${
        status === "PASSED" ? "通过" : status === "FAILED" ? "不通过" : "重置"
      }`,
    );
  });
}

export function createFormalReview(actor: SessionUser, versionId: number, comment: string) {
  assert(canManageWorkflow(actor), "只有软件经理或系统管理员可以组织转正评审。", "FORBIDDEN");
  assert(comment.trim().length >= 10, "请填写转正评审说明（至少 10 个字符）。");
  const version = one<{
    id: number;
    package_id: number;
    package_name: string;
    version: string;
    status: PackageStatus;
  }>(
    `SELECT pv.id, pv.package_id, p.name AS package_name, pv.version, pv.status
     FROM package_versions pv JOIN packages p ON p.id = pv.package_id WHERE pv.id = ?`,
    versionId,
  );
  assert(version, "软件包版本不存在。", "NOT_FOUND");
  assert(version.status === "PENDING_FORMAL", "只有全部绑定验证通过的版本才能组织转正评审。");
  const counts = one<{ total: number; passed: number }>(
    "SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'PASSED' THEN 1 ELSE 0 END) AS passed FROM binding_tasks WHERE package_version_id = ?",
    versionId,
  );
  assert(Number(counts?.total ?? 0) > 0, "该版本没有绑定验证记录，不能转正。");
  assert(
    Number(counts?.passed ?? 0) === Number(counts?.total ?? 0),
    "仍有项目测试节点未完成绑定验证，不能发起转正评审。",
  );
  const latest = one<{ status: string }>(
    "SELECT status FROM formal_reviews WHERE package_version_id = ? ORDER BY id DESC LIMIT 1",
    versionId,
  );
  assert(
    !latest || latest.status === "REJECTED",
    latest?.status === "APPROVED" ? "该版本转正评审已通过。" : "该版本已有进行中的转正评审。",
  );
  return transaction(() => {
    const timestamp = now();
    const result = run(
      `INSERT INTO formal_reviews
        (package_version_id, comment, status, requested_by, created_at)
       VALUES (?, ?, 'PENDING', ?, ?)`,
      versionId,
      comment.trim(),
      actor.id,
      timestamp,
    );
    const id = Number(result.lastInsertRowid);
    audit(
      actor.id,
      "CREATE_FORMAL_REVIEW",
      "PACKAGE",
      version.package_id,
      `为 ${version.package_name} ${version.version} 发起转正评审`,
    );
    return id;
  });
}

export function decideFormalReview(
  actor: SessionUser,
  reviewId: number,
  decision: "APPROVED" | "REJECTED",
  conclusion: string,
) {
  assert(canReview(actor), "只有评审专家或系统管理员可以给出转正评审结论。", "FORBIDDEN");
  assert(conclusion.trim().length >= 4, "请填写评审结论（至少 4 个字符）。");
  const review = one<{
    id: number;
    status: string;
    requested_by: number | null;
    package_id: number;
    package_name: string;
    version: string;
  }>(
    `SELECT fr.id, fr.status, fr.requested_by, pv.package_id, p.name AS package_name, pv.version
     FROM formal_reviews fr
     JOIN package_versions pv ON pv.id = fr.package_version_id
     JOIN packages p ON p.id = pv.package_id
     WHERE fr.id = ?`,
    reviewId,
  );
  assert(review, "转正评审不存在。", "NOT_FOUND");
  assert(review.status === "PENDING", "该转正评审已处理。");
  assert(canApproveReview(actor, review.requested_by), "不能评审自己发起的转正申请。", "FORBIDDEN");
  transaction(() => {
    run(
      `UPDATE formal_reviews SET status = ?, conclusion = ?, reviewed_by = ?, reviewed_at = ?
       WHERE id = ?`,
      decision,
      conclusion.trim(),
      actor.id,
      now(),
      reviewId,
    );
    audit(
      actor.id,
      "DECIDE_FORMAL_REVIEW",
      "PACKAGE",
      review.package_id,
      `${review.package_name} ${review.version} 转正评审${decision === "APPROVED" ? "通过" : "驳回"}：${conclusion.trim()}`,
    );
  });
}

export function releaseFormal(actor: SessionUser, versionId: number, flowNo: string) {
  assert(canManageWorkflow(actor), "只有软件经理或系统管理员可以发布正式版本。", "FORBIDDEN");
  assert(flowNo.trim().length >= 3, "请填写转正电子流。");
  const version = one<{
    id: number;
    package_id: number;
    package_name: string;
    version: string;
    status: PackageStatus;
  }>(
    `SELECT pv.id, pv.package_id, p.name AS package_name, pv.version, pv.status
     FROM package_versions pv JOIN packages p ON p.id = pv.package_id WHERE pv.id = ?`,
    versionId,
  );
  assert(version, "软件包版本不存在。", "NOT_FOUND");
  assert(version.status === "PENDING_FORMAL", "只有待转正的版本可以发布正式版本。");
  transaction(() => {
    const timestamp = now();
    run(
      `UPDATE package_versions
       SET status = 'FORMAL', formal_released_at = ?, form_flow_no = ?, updated_at = ?
       WHERE id = ?`,
      timestamp,
      flowNo.trim(),
      timestamp,
      versionId,
    );
    audit(
      actor.id,
      "RELEASE_FORMAL",
      "PACKAGE",
      version.package_id,
      `发布 ${version.package_name} ${version.version} 正式版本，电子流：${flowNo.trim()}`,
    );
  });
}
