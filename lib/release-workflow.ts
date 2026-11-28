import { createAuditLogWriter } from "./audit-log";
import { all, db, one, run, transaction } from "./db";
import {
  assertProjectManager,
  assertVersionProjectManager,
  canManageProjectWorkflowForProject,
} from "./access";
import { assert, DomainError } from "./domain-error";
import { getActiveReleaseRequests, getFormalReleaseCheck } from "./trial-readiness";
import {
  findReadyTrialProject,
  getRiskTrialAdmissionEvidence,
  getTrialNodeUsages,
  getTrialReleaseEligibility,
  missingTrialNodeAssignments,
  trialReleaseStateKey,
} from "./trial-eligibility";
import { insertTrialRiskAdmission, invalidateTrialRiskAdmissionForVersion } from "./trial-risk-admissions";
import type { SessionUser } from "./types";
import { releaseFlowUrl } from "./release-flow";
import {
  refreshVersionAggregate,
  TRIAL_PENDING_VERSION_STATUSES_SQL,
} from "./transfer-requests";
import { getVersionForVoid } from "./version-void";
import { voidVersionRecords } from "./version-void-workflow";

const audit = createAuditLogWriter(db);
const now = () => new Date().toISOString();

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
    const entry = getRiskTrialAdmissionEvidence(input.requestId);
    assert(entry?.stage && entry.stage === input.stage && entry.batchId === (input.batchId ?? null),
      "转测状态已变化，请刷新页面并按当前阶段登记风险原因。");
    assert(!entry.registered, "该版本已经登记风险试制原因，请查看待发布试制队列。");
    assert(entry.riskProjectCount > 0 && entry.unavailableRequestCount === 0,
      "该版本已满足普通试制条件，或仍缺少共享试制所需的项目转测申请。");
    insertTrialRiskAdmission(db, {
      versionId: request.versionId, requestId: input.requestId, projectId: project.id, projectName: project.name,
      batchId: entry.batchId, stage: entry.stage, reason, actorId: actor.id, createdAt: now(),
    });
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
      invalidateTrialRiskAdmissionForVersion(db, anchor.package_version_id, timestamp);
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
