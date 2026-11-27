import "server-only";

import { assertVersionProjectManager, canConfirmBindingNodeForProject, canManageProjectWorkflowForProject } from "./access";
import { createAuditLogWriter } from "./audit-log";
import {
  bindingReleaseAvailability,
  bindingRequirementAvailability,
  OPEN_BINDING_REQUIREMENT_STATUSES_SQL,
  type BindingReleaseFacts,
} from "./binding-availability";
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
import { all, db, one, run, transaction } from "./db";
import { assert } from "./domain-error";
import { bindingFlowApprovalBlocker, canSubmitBindingFlow } from "./permissions";
import { refreshTrialReadiness } from "./trial-readiness";
import type { SessionUser } from "./types";

const audit = createAuditLogWriter(db);
const now = () => new Date().toISOString();

function readBindingDecisionTarget(actor: SessionUser, requestId: number) {
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
  return anchor;
}

export function pushBindingTasks(actor: SessionUser, requestId: number) {
  return transaction(() => {
    const anchor = readBindingDecisionTarget(actor, requestId);
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
    const anchor = readBindingDecisionTarget(actor, requestId);
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
