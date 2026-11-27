import {
  canAccessProjectPage,
  canManagePackageArea,
  canManageProjectWorkflowForProject,
  canReadPackageWorkflow,
} from "./access";
import { all, db, one } from "./db";
import { packageIdentity } from "./package-identity";
import { canApproveBindingFlow, canSubmitBindingFlow, isBindingOpen } from "./permissions";
import { getTrialNodeUsages, missingTrialNodeAssignments, trialEligibilityCtes } from "./trial-eligibility";
import { getActiveReleaseRequests, getFormalReleaseCheck } from "./trial-readiness";
import { TRIAL_PENDING_VERSION_STATUSES_SQL } from "./transfer-requests";
import type { SessionUser } from "./types";
import { workflowHref } from "./workflow-links";
import { getReadableTrialDetail } from "./workflow-queries";

type ReleaseGuidanceItem = { title: string; detail?: string; href?: string; actionLabel?: string };
type GuidanceContext = {
  projectId?: number;
  returnTo?: string;
  bindingListState?: Record<string, string | number | undefined>;
};
type ReleaseGuidance = {
  status: string;
  canManage: boolean;
  items: ReleaseGuidanceItem[];
  description?: string;
  href?: string;
};
type FormalReleaseGuidance = ReleaseGuidance & { pendingFlowCount: number };

const pendingTrialStatuses = new Set(["PENDING_TRANSFER", "IN_TEST", "PENDING_TRIAL"]);

function versionRecord(versionId: number) {
  return one<{
    id: number;
    status: string;
    version: string;
    packageId: number;
    code: string;
    name: string;
    areaId: number | null;
    bindingMode: string;
  }>(`SELECT pv.id, pv.status, pv.version, pv.binding_mode AS bindingMode,
            p.id AS packageId, p.code, p.name, p.area_id AS areaId
     FROM package_versions pv JOIN packages p ON p.id = pv.package_id WHERE pv.id = ?`, versionId);
}

export function getTrialNodeGuidance(user: SessionUser, packageId: number): ReleaseGuidanceItem[] {
  const items: ReleaseGuidanceItem[] = [];
  const nodes = getTrialNodeUsages(packageId);
  for (const node of nodes) {
    const missing = missingTrialNodeAssignments(node);
    if (missing.length === 0) continue;
    const canConfigure = canManageProjectWorkflowForProject(user, node.projectId);
    items.push(canConfigure
      ? {
        title: `${node.projectName} · ${node.nodeName} 缺少节点配置`,
        detail: `请配置${missing.join("、")}。`,
        href: `/settings/projects/${node.projectId}/nodes/${node.nodeId}`,
        actionLabel: "配置节点",
      }
      : { title: "使用项目缺少节点配置", detail: "请联系该项目的软件经理配置绑定责任人和审批人。" });
  }
  const hidden = items.filter((item) => !item.href);
  return hidden.length > 0
    ? [...items.filter((item) => item.href), { title: `其他使用项目有 ${hidden.length} 个节点缺少配置`, detail: hidden[0].detail }]
    : items;
}

/** Resolve the release action and its dependencies with the same eligibility CTE used by the trial queue and publish service. */
export function getTrialReleaseGuidance(user: SessionUser, versionId: number, context: GuidanceContext = {}): ReleaseGuidance | null {
  const version = versionRecord(versionId);
  if (!version || !pendingTrialStatuses.has(version.status)) return null;
  const evidence = all<{
    projectId: number;
    projectName: string;
    requestId: number | null;
    requestStatus: string | null;
    usable: number | null;
    passed: number;
    releaseMode: "INTEGRATION" | "RISK" | null;
    batchId: number | null;
    batchCode: string | null;
    batchStatus: string | null;
  }>(`WITH ${trialEligibilityCtes(`SELECT id, package_id FROM package_versions
          WHERE status IN ${TRIAL_PENDING_VERSION_STATUSES_SQL} AND id = ?`)}
     SELECT e.projectId, p.name AS projectName, e.requestId, e.requestStatus, e.usable, e.passed,
            q.releaseMode, e.batchId, b.code AS batchCode, b.status AS batchStatus
     FROM trial_project_evidence e JOIN trial_eligibility q ON q.versionId = e.versionId
     JOIN projects p ON p.id = e.projectId
     LEFT JOIN integration_batches b ON b.id = e.batchId
     ORDER BY p.sort_order`, versionId);
  if (context.projectId && !evidence.some((row) => row.projectId === context.projectId)) return null;
  const readableProjectIds = new Set(evidence.filter(({ projectId }) => canAccessProjectPage(user, projectId)).map(({ projectId }) => projectId));
  const canRead = (projectId: number) => readableProjectIds.has(projectId);
  const readable = evidence.filter((row) => canRead(row.projectId));
  if (readable.length === 0 && user.role !== "ADMIN" && !canReadPackageWorkflow(user, version.packageId, context.projectId)) return null;
  const manageable = readable.filter((row) => canManageProjectWorkflowForProject(user, row.projectId));
  const preferred = manageable.find((row) => row.projectId === context.projectId) ?? manageable[0];
  const items: ReleaseGuidanceItem[] = [];
  let restricted = 0;
  const args = { returnTo: context.returnTo };
  const canConfigurePackage = canManagePackageArea(user, version.areaId);
  const identity = packageIdentity(version);
  for (const row of evidence) {
    if (row.passed || (row.releaseMode && row.usable)) continue;
    if (!canRead(row.projectId)) {
      restricted += 1;
      continue;
    }
    const mayArrange = canManageProjectWorkflowForProject(user, row.projectId);
    if (!row.requestId || !row.usable) {
      items.push({
        title: `${row.projectName} · ${!row.requestId ? "缺少本版本的转测申请" : "当前转测申请不能发布试制"}`,
        detail: "请核对软件包在该项目的使用范围和本版本的转测记录。",
        href: canConfigurePackage
          ? `/settings/packages/${version.packageId}#package-usage`
          : workflowHref(`/versions/${versionId}`, row.projectId, args),
        actionLabel: canConfigurePackage ? "核对使用范围" : "查看项目记录",
      });
      continue;
    }
    const requestsHref = workflowHref("/submissions", row.projectId, {
      ...args,
      q: identity.code,
      request: row.requestStatus === "PENDING" ? row.requestId : undefined,
    });
    const canInspectBatch = row.batchStatus !== "DRAFT" || mayArrange;
    const batchHref = row.batchId && canInspectBatch
      ? workflowHref(`/integration/${row.batchId}`, row.projectId, args) : undefined;
    const stage = canInspectBatch && row.batchStatus === "DRAFT" ? "批次待发起"
      : row.requestStatus === "IN_TEST" ? "等待集成测试结论"
        : row.requestStatus === "FAILED" ? "集成测试未通过"
          : row.requestStatus === "BLOCKED" ? "集成测试受阻"
            : row.requestStatus === "PASSED" ? "缺少有效的测试通过结论" : "待安排转测";
    items.push({
      title: `${row.projectName} · ${stage}`,
      detail: `${row.batchCode && canInspectBatch ? `批次 ${row.batchCode}。` : ""}${mayArrange ? "确认本项目的转测或测试结果。" : "请联系该项目的软件经理。"}`,
      href: batchHref ?? requestsHref,
      actionLabel: batchHref ? "查看转测批次" : "查看转测申请",
    });
  }
  if (!evidence.length) {
    items.push({
      title: "软件包没有在行使用项目",
      detail: "先为软件包配置在行项目和测试节点。",
      href: canConfigurePackage ? `/settings/packages/${version.packageId}#package-usage` : undefined,
      actionLabel: "配置使用范围",
    });
  }
  if (restricted > 0) items.push({ title: `还有 ${restricted} 个使用项目未完成验收`, detail: "请联系相应项目的软件经理核对转测或测试结论。" });
  if (items.length === 0) items.push(...getTrialNodeGuidance(user, version.packageId));
  if (!preferred && items.length === 0) items.push({ title: "等待负责项目的软件经理发布", detail: "软件经理或管理员可以发布共享试制。" });
  return {
    status: version.status,
    canManage: Boolean(preferred) || user.role === "ADMIN",
    description: `${identity.code} ${version.version} · ${evidence.filter((row) => row.passed).length}/${evidence.length} 个在行使用项目验收通过`,
    href: preferred?.requestId && items.length === 0
      ? workflowHref(`/trial/ready/${preferred.requestId}`, preferred.projectId, args) : undefined,
    items,
  };
}

/** Check the release prerequisites across active released requests, with links only for project records the actor can open. */
export function getFormalReleaseGuidance(user: SessionUser, versionId: number, context: GuidanceContext = {}): FormalReleaseGuidance | null {
  const version = versionRecord(versionId);
  if (!version) return null;
  const requests = getActiveReleaseRequests(db, versionId);
  if (!requests.length || (context.projectId && !requests.some((request) => request.projectId === context.projectId))) return null;
  const readable = requests.flatMap((request) => {
    const detail = getReadableTrialDetail(user, request.id);
    return detail ? [{ ...request, detail }] : [];
  });
  if (readable.length === 0) return null;
  const manageable = readable.filter((request) => canManageProjectWorkflowForProject(user, request.projectId));
  const preferred = manageable.find((request) => request.projectId === context.projectId) ?? manageable[0];
  const canManage = Boolean(preferred);
  const identity = packageIdentity(version);
  const args = { returnTo: context.returnTo };
  const bindingArgs = { ...context.bindingListState, ...args };
  const projectScope = (projectId: number) => canAccessProjectPage(user, projectId) ? projectId : undefined;
  const traceHref = workflowHref(`/versions/${versionId}`, context.projectId === undefined ? undefined : projectScope(context.projectId), args);
  if (!isBindingOpen(version.status)) return {
    status: version.status, canManage, pendingFlowCount: 0,
    description: `${identity.code} ${version.version}`,
    items: [{
      title: version.status === "FORMAL" ? "该版本已转正" : version.status === "VOID" ? "该版本已作废" : "该版本不在转正流程中",
      href: traceHref,
      actionLabel: "查看版本全链路",
    }],
  };

  const { binding, batches, bindingsReady, pendingFlowCount, blocker } = getFormalReleaseCheck(db, version, requests);
  const items: ReleaseGuidanceItem[] = [];
  let shownFlows = 0;
  let shownUnsettled = 0;
  let hiddenBatches = 0;
  const decision = preferred ?? readable[0];

  if (version.bindingMode === "PENDING") items.push({
    title: "等待软件经理决定绑定方式",
    detail: "先推送绑定任务，或登记整版无需绑定。",
    href: workflowHref(`/trial/${decision.id}`, projectScope(decision.projectId), bindingArgs) + "#binding-decision",
    actionLabel: canManage ? "决定绑定方式" : "查看绑定详情",
  });

  for (const row of readable) {
    const trialHref = workflowHref(`/trial/${row.id}`, projectScope(row.projectId), bindingArgs);
    for (const node of row.detail.requirements) {
      const nodeTitle = `${row.projectName} · ${node.nodeName}`;
      const pending = node.flows.filter((flow) => flow.status === "PENDING");
      shownFlows += pending.length;
      for (const flow of pending) items.push({
        title: `${nodeTitle} · ${flow.flowNo} 待审批`,
        detail: `通过条码 ${node.passedBarcodeCount}/${node.requiredCount}。指定审批人：${flow.approverName ?? "未配置"}。`,
        href: `${trialHref}#binding-flow-${flow.id}`,
        actionLabel: canApproveBindingFlow(user, flow.approverId) && flow.submittedById !== user.id ? "去审批" : "查看待审批电子流",
      });
      const settled = version.bindingMode === "SKIPPED" ? node.status === "CANCELLED"
        : (node.status === "CANCELLED" && node.waivedAt !== null) || (node.status === "PASSED" && node.confirmedAt !== null);
      if (!settled) shownUnsettled += 1;
      if (settled || version.bindingMode === "PENDING") continue;
      const ready = node.pushedAt !== null && node.passedBarcodeCount >= node.requiredCount && node.unreviewedApprovedCount === 0;
      const missing = Math.max(0, node.requiredCount - (node.submittedCount - node.failedBarcodeCount));
      if (!ready && pending.length > 0 && missing === 0 && node.unreviewedApprovedCount === 0 && node.failedBarcodeCount === 0) continue;
      const reviewTitle = ready ? "待确认节点通过" : node.unreviewedApprovedCount > 0 ? "待判定设备条码"
        : node.failedBarcodeCount > 0 ? "待核对失败条码" : null;
      const reviewDetail = `通过条码 ${node.passedBarcodeCount}/${node.requiredCount}`
        + (node.unreviewedApprovedCount > 0 ? `，${node.unreviewedApprovedCount} 条待判定` : "")
        + (node.failedBarcodeCount > 0 ? `，${node.failedBarcodeCount} 条 FAIL` : "");
      items.push({
        title: `${nodeTitle} · ${!node.pushedAt ? "绑定任务尚未推送" : reviewTitle ?? "待提交或补充绑定电子流"}`,
        detail: !node.pushedAt ? "请先由该项目的软件经理推送节点绑定任务。"
          : reviewTitle ? `${reviewDetail}。请由软件包责任人、该节点所属项目的软件经理或管理员办理。`
            : `已登记 ${node.submittedCount}/${node.requiredCount} 个去重条码，还需补充 ${missing} 个。${canSubmitBindingFlow(user, node.bindingOwnerId)
              ? "可在节点提交电子流。" : `请联系绑定责任人${node.bindingOwnerName ? ` ${node.bindingOwnerName}` : ""}补充。`}`,
        href: `${trialHref}#binding-node-${node.id}`,
        actionLabel: "查看节点",
      });
    }
  }
  if (pendingFlowCount > shownFlows) items.push({ title: `其他使用项目还有 ${pendingFlowCount - shownFlows} 条待审批电子流`, detail: "请联系相应项目的软件经理协调处理。" });
  const hiddenNodes = binding.total - binding.settled - shownUnsettled;
  if (!bindingsReady && version.bindingMode === "PUSHED" && hiddenNodes > 0) items.push({
    title: "其他使用项目还有绑定条件待核对",
    detail: `还有 ${hiddenNodes} 个节点未完成。请联系相应项目的软件经理。`,
  });
  for (const batch of batches) {
    if (!canAccessProjectPage(user, batch.projectId)
      || (batch.status === "DRAFT" && !canManageProjectWorkflowForProject(user, batch.projectId))) {
      hiddenBatches += 1;
      continue;
    }
    items.push({
      title: `${batch.projectName} · 批次 ${batch.code} ${batch.status === "DRAFT" ? "待发起" : "在测"}`,
      detail: "已安排的转测批次需要结束后再转正。",
      href: workflowHref(`/integration/${batch.id}`, batch.projectId, args),
      actionLabel: "查看转测批次",
    });
  }
  if (hiddenBatches > 0) items.push({ title: `还有 ${hiddenBatches} 个已安排的转测批次未结束`, detail: "请联系相应项目的软件经理核对进度。" });
  const ready = blocker === null;
  if (!ready && items.length === 0) items.push({
    title: "仍有绑定或测试记录待核对", href: traceHref, actionLabel: "查看版本全链路",
  });
  if (ready && !canManage) items.push({
    title: "等待负责项目的软件经理发布", detail: "软件经理或管理员可以发布正式版本。",
    href: traceHref, actionLabel: "查看版本全链路",
  });
  return {
    status: version.status,
    canManage,
    pendingFlowCount,
    description: `${identity.code} ${version.version} · ${version.bindingMode === "SKIPPED" ? "整版无需绑定" : `已完成 ${binding.settled}/${binding.total} 个节点`}`,
    href: ready && preferred ? workflowHref(`/formal/${versionId}`, preferred.projectId, args) : undefined,
    items,
  };
}
