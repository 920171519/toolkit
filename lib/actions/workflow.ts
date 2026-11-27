"use server";

import { DRAFT_CREATED_MESSAGE, draftRequestListState } from "@/lib/batch-preparation";
import { getWorkflowListState } from "@/lib/workflow-list";
import { safeOverviewReturnPath } from "@/lib/return-to";

import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { actionUser, failure, idList, numberValue, raw, refreshAll, successRedirect, text } from "@/lib/action-helpers";
import { DomainError } from "@/lib/domain-error";
import { workflowHref } from "@/lib/workflow-links";
import { trialQueueParams } from "@/lib/trial-queue";
import { integrationHistoryParams, readIntegrationHistory } from "@/lib/integration-history";
import { isBatchConclusion } from "@/lib/integration-conclusion";
import { readTraceListState, traceListParams } from "@/lib/version-trace-list";
import { directoryActionHref } from "@/lib/settings-directory";
import { hasVersionRequest } from "@/lib/workflow-queries";
import {
  cancelBindingFlow,
  confirmBindingRequirement,
  decideBindingFlow,
  pushBindingTasks,
  saveBindingBarcodeResults,
  skipBindingAndEnterFormal,
  submitBindingFlow,
  waiveBindingRequirement,
} from "@/lib/binding-workflow";
import {
  addBatchProgress,
  cancelTransfer,
  completeBatchTest,
  createBatchDraft,
  type CreateBatchInput,
  deleteDraftBatch,
  releaseFormal,
  releaseTrial,
  sendBatch,
  submitTransfer,
  terminateBatch,
  abandonTrialRelease,
  voidPackageVersion,
} from "@/lib/workflow";

function workflowSuccessRedirect(
  formData: FormData,
  path: string,
  message: string,
  params?: Record<string, string | number | undefined>,
  anchor?: string,
): never {
  const returnTo = safeOverviewReturnPath(text(formData, "returnTo"));
  const search = Object.fromEntries(
    Array.from(formData, ([name, value]) => [name, typeof value === "string" ? value : undefined] as const),
  );
  const trialQuery = path === "/trial" || path.startsWith("/trial/") ? trialQueueParams(search) : undefined;
  const integrationQuery = path.startsWith("/integration/") && (search.history === "1" || search.view === "history")
    ? integrationHistoryParams(readIntegrationHistory(search))
    : undefined;
  const href = workflowHref(path, numberValue(formData, "scopeProjectId"), {
    ...params, ...trialQuery, ...integrationQuery, returnTo, flash: message,
  });
  redirect(anchor ? `${href}#${anchor}` : href);
}

function actionListState(formData: FormData) {
  return getWorkflowListState({ q: text(formData, "q"), page: text(formData, "page"), pageSize: text(formData, "pageSize"), returnTo: text(formData, "returnTo") });
}

export async function submitTransferAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await actionUser();
  const packageId = numberValue(formData, "packageId");
  if (!packageId) return { error: "请选择软件包。" };
  let projectCount = 0;
  try {
    const result = submitTransfer(user, {
      packageId,
      version: text(formData, "version"),
      changeSummary: text(formData, "changeSummary"),
      archiveUrl: text(formData, "archiveUrl"),
      buildUrl: text(formData, "buildUrl"),
      scopeProjectId: numberValue(formData, "scopeProjectId") ?? undefined,
    });
    projectCount = result.projectCount;
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  workflowSuccessRedirect(formData, "/submissions", `转测申请已提交，并发送至 ${projectCount} 个项目。`);
}

export async function cancelTransferAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await actionUser();
  const versionId = numberValue(formData, "versionId");
  if (!versionId) return { error: "转测申请参数无效。" };
  try {
    cancelTransfer(user, versionId);
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  workflowSuccessRedirect(formData, "/submissions", "转测申请已撤回。", actionListState(formData));
}

export async function createBatchAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await actionUser();
  const projectId = numberValue(formData, "projectId");
  const draftBatchId = numberValue(formData, "draftBatchId") ?? undefined;
  const expectedDraftRevision = numberValue(formData, "expectedDraftRevision") ?? undefined;
  const code = text(formData, "code");
  const title = text(formData, "title");
  if (!projectId) return { error: "请选择项目。" };
  if (!code) return { error: "请填写批次号。" };
  let items: CreateBatchInput["items"] = [];
  try {
    const payload = JSON.parse(text(formData, "items")) as unknown;
    if (!Array.isArray(payload)) throw new Error("invalid items");
    items = payload.map((item) => {
      const record = item as { packageId?: unknown; packageVersionId?: unknown; carryPrevious?: unknown };
      const packageId = Number(record.packageId);
      const packageVersionId = Number(record.packageVersionId);
      if (!Number.isSafeInteger(packageId) || !Number.isSafeInteger(packageVersionId)) throw new Error("invalid item");
      if (record.carryPrevious !== undefined && typeof record.carryPrevious !== "boolean") throw new Error("invalid carry choice");
      return { packageId, packageVersionId, carryPrevious: record.carryPrevious };
    });
  } catch {
    return { error: "配套版本选择已失效，请刷新页面后重试。" };
  }
  if (items.length === 0) return { error: "请为整套配套选择版本。" };
  let batchId: number;
  try {
    batchId = createBatchDraft(user, { projectId, draftBatchId, expectedDraftRevision, code, title, items });
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  workflowSuccessRedirect(formData, `/integration/${batchId}`, draftBatchId ? "转测草稿已更新。核对配套后即可发起集成测试。" : DRAFT_CREATED_MESSAGE,
    draftBatchId ? { ...actionListState(formData), ...draftRequestListState({ fromRequests: text(formData, "fromRequests"), request: text(formData, "request") }) } : undefined);
}

export async function addBatchProgressAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await actionUser();
  const batchId = numberValue(formData, "batchId");
  if (!batchId) return { error: "批次参数无效。" };
  try {
    addBatchProgress(user, batchId, text(formData, "content"));
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  workflowSuccessRedirect(formData, `/integration/${batchId}`, "进展说明已提交。", actionListState(formData));
}

export async function deleteDraftBatchAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await actionUser();
  const batchId = numberValue(formData, "batchId");
  if (!batchId) return { error: "批次参数无效。" };
  try {
    deleteDraftBatch(user, batchId);
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  const requestList = draftRequestListState({ fromRequests: text(formData, "fromRequests"), request: text(formData, "request") });
  workflowSuccessRedirect(formData, "/submissions", "转测草稿已删除。", { view: requestList.fromRequests ? undefined : "drafts", ...actionListState(formData), request: requestList.request });
}

export async function sendBatchAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await actionUser();
  const batchId = numberValue(formData, "batchId");
  if (!batchId) return { error: "批次参数无效。" };
  let batchCode: string;
  try {
    batchCode = sendBatch(user, batchId);
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  workflowSuccessRedirect(formData, `/integration/${batchId}`, `${batchCode} 已发起集成测试，等待本项目集成测试负责人提交结论。`, actionListState(formData));
}

export async function terminateBatchAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await actionUser();
  const batchId = numberValue(formData, "batchId");
  if (!batchId) return { error: "批次参数无效。" };
  try {
    terminateBatch(user, batchId, raw(formData, "reason"));
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  workflowSuccessRedirect(formData, `/integration/${batchId}`, "本批次已终止，相关项目转测申请已退回待安排。", actionListState(formData));
}

export async function completeBatchAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await actionUser();
  const batchId = numberValue(formData, "batchId");
  const conclusion = text(formData, "conclusion");
  const issueAttribution = text(formData, "issueAttribution");
  if (!batchId) return { error: "批次参数无效。" };
  if (!isBatchConclusion(conclusion)) return { error: "请补齐测试结论。", fieldErrors: { conclusion: "请选择测试结论。" } };
  const uploaded = formData.get("reportFile");
  const reportFile = uploaded instanceof File && uploaded.size > 0 ? uploaded : null;
  if (!reportFile) return { error: "请补齐验证报告。", fieldErrors: { reportFile: "请上传非空的验证报告。" } };
  let voidedCount = 0;
  try {
    const result = await completeBatchTest(user, batchId, {
      conclusion,
      issueAttribution,
      testSummary: text(formData, "testSummary"),
      reportFile,
      affectedVersionIds: idList(formData, "affectedVersionId"),
    });
    voidedCount = result.voidedCount;
  } catch (error) {
    if (error instanceof DomainError && error.code === "INVALID_TEST_REPORT") {
      return { error: "验证报告无法上传。", fieldErrors: { reportFile: error.message } };
    }
    return failure(error);
  }
  refreshAll();
  workflowSuccessRedirect(formData, `/integration/${batchId}`, voidedCount > 0
    ? `测试结论已提交，${voidedCount} 个受影响的风险试制版本已作废。`
    : "测试结论已提交，验证报告已上传。", actionListState(formData));
}

export async function releaseTrialAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await actionUser();
  const requestId = numberValue(formData, "requestId");
  if (!requestId) return { error: "项目版本参数无效。" };
  let taskCount = 0;
  try {
    taskCount = releaseTrial(user, requestId, text(formData, "trialFormNo"), text(formData, "eligibility"), text(formData, "reviewMinutes"));
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  workflowSuccessRedirect(formData, `/trial/${requestId}`, `试制版本已发布，已生成 ${taskCount} 个节点绑定任务。请先决定是否推送绑定任务。`,
    actionListState(formData), "binding-decision");
}

export async function pushBindingTasksAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await actionUser();
  const requestId = numberValue(formData, "requestId");
  if (!requestId) return { error: "项目版本参数无效。" };
  let count = 0;
  try {
    count = pushBindingTasks(user, requestId);
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  workflowSuccessRedirect(formData, `/trial/${requestId}`, `已向全部使用项目的绑定责任人推送 ${count} 个节点绑定任务。请由各节点责任人提交电子流。`,
    actionListState(formData), "binding-nodes");
}

export async function skipBindingAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await actionUser();
  const requestId = numberValue(formData, "requestId");
  if (!requestId) return { error: "项目版本参数无效。" };
  let result: ReturnType<typeof skipBindingAndEnterFormal>;
  try {
    result = skipBindingAndEnterFormal(user, requestId, text(formData, "reason"));
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  workflowSuccessRedirect(
    formData,
    result.enteredFormal ? `/formal/${result.versionId}` : `/trial/${requestId}`,
    result.enteredFormal ? "已记录不进行绑定验证的原因，全部使用项目进入待转正。请核对本版本的发布条件。" : "已记录无需绑定。关联转测批次结束后再进入待转正。",
    actionListState(formData),
    result.enteredFormal ? undefined : "binding-formal",
  );
}

export async function waiveBindingRequirementAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await actionUser();
  const requirementId = numberValue(formData, "requirementId");
  if (!requirementId) return { error: "绑定任务参数无效。" };
  let result: ReturnType<typeof waiveBindingRequirement>;
  try {
    result = waiveBindingRequirement(user, requirementId, text(formData, "reason"));
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  workflowSuccessRedirect(
    formData,
    `/trial/${result.requestId}`,
    result.enteredFormal ? "已登记此节点无需绑定，版本已进入待转正。" : "已登记此节点无需绑定。可查看转正发布条件了解剩余步骤。",
    actionListState(formData),
    result.enteredFormal ? "binding-formal" : `binding-node-${requirementId}`,
  );
}

function bindingBarcodeFormFields(formData: FormData, prefix: string): Map<number, string> {
  const fields = new Map<number, string>();
  for (const [name, value] of formData) {
    if (!name.startsWith(prefix)) continue;
    const suffix = name.slice(prefix.length);
    const barcodeId = Number(suffix);
    if (!/^[1-9]\d*$/.test(suffix) || !Number.isSafeInteger(barcodeId) || fields.has(barcodeId) || typeof value !== "string") {
      throw new DomainError("设备条码参数无效。");
    }
    fields.set(barcodeId, value);
  }
  return fields;
}

export async function saveBindingBarcodeResultsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await actionUser();
  const requirementId = numberValue(formData, "requirementId");
  const flowId = numberValue(formData, "flowId");
  if (!requirementId || !flowId) return { error: "绑定电子流参数无效。" };
  let result: ReturnType<typeof saveBindingBarcodeResults>;
  try {
    result = saveBindingBarcodeResults(user, requirementId, flowId, text(formData, "evidenceKey"), bindingBarcodeFormFields(formData, "result_"));
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  workflowSuccessRedirect(formData, `/trial/${result.requestId}`, "已保存条码判定。", actionListState(formData), `binding-barcodes-${flowId}`);
}

export async function confirmBindingRequirementAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await actionUser();
  const requirementId = numberValue(formData, "requirementId");
  if (!requirementId) return { error: "绑定任务参数无效。" };
  const saveReasonsOnly = text(formData, "intent") === "save-reasons";
  let result: ReturnType<typeof confirmBindingRequirement>;
  try {
    result = confirmBindingRequirement(user, requirementId, text(formData, "evidenceKey"),
      bindingBarcodeFormFields(formData, "failureReason_"), saveReasonsOnly);
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  if (saveReasonsOnly) {
    workflowSuccessRedirect(formData, `/trial/${result.requestId}`, "已保存失败原因，节点仍待确认。",
      actionListState(formData), `binding-node-${requirementId}`);
  }
  workflowSuccessRedirect(
    formData,
    `/trial/${result.requestId}`,
    result.enteredFormal ? "已确认节点通过，版本已进入待转正。" : "已确认节点通过。可在转正发布条件中查看剩余步骤。",
    actionListState(formData),
    "binding-formal",
  );
}

export async function abandonTrialReleaseAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await actionUser();
  const requestId = numberValue(formData, "requestId");
  if (!requestId) return { error: "项目版本参数无效。" };
  let withdrawnRisk = false;
  try {
    withdrawnRisk = abandonTrialRelease(user, requestId, text(formData, "conclusion"), text(formData, "eligibility")).withdrawnRisk;
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  workflowSuccessRedirect(formData, "/trial", withdrawnRisk
    ? "已撤回本次风险试制，转测和集成测试继续。"
    : "已提交放弃发布试制结论，该版本将不再发布试制。", actionListState(formData));
}

export async function voidPackageVersionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await actionUser();
  const versionId = numberValue(formData, "versionId");
  if (!versionId) return { error: "版本参数无效。" };
  const from = text(formData, "voidFrom");
  const requestId = numberValue(formData, "requestId");
  if (from === "trial-queue" && !requestId) return { error: "项目版本参数无效。" };
  let packageId: number;
  try {
    packageId = voidPackageVersion(user, versionId, text(formData, "reason"),
      from === "trial-queue" && requestId ? { requestId, eligibility: text(formData, "eligibility") } : undefined);
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  const message = "该软件包版本已作废，不再作为可用版本。";
  if (from === "package-settings") {
    successRedirect(directoryActionHref("packages", formData, packageId), message);
  }
  if (from === "trial-queue") {
    workflowSuccessRedirect(formData, "/trial", "该软件包版本及各项目转测申请已作废。", actionListState(formData));
  }
  if (from === "trial" && requestId && hasVersionRequest(requestId, versionId)) {
    workflowSuccessRedirect(formData, `/trial/${requestId}`, "共享试制版本已作废。", actionListState(formData));
  }
  const state = readTraceListState(Object.fromEntries(formData));
  workflowSuccessRedirect(formData, `/versions/${versionId}`, message, {
    ...traceListParams(state),
    from: text(formData, "from") === "formal" ? "formal" : undefined,
  });
}

export async function submitBindingFlowAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await actionUser();
  const requirementId = numberValue(formData, "requirementId");
  const approverId = numberValue(formData, "approverId");
  if (!requirementId) return { error: "绑定任务参数无效。" };
  if (!approverId) return { error: "请选择绑定电子流审批人。" };
  const rawBarcodes = formData.getAll("barcodes").filter((item): item is string => typeof item === "string").join("\n");
  const barcodes = rawBarcodes.split(/[\n,，;；]+/).map((barcode) => barcode.trim()).filter(Boolean);
  if (barcodes.length === 0) {
    return { error: "请至少添加一个有效设备条码。" };
  }
  const webUrl = text(formData, "webUrl");
  let result: ReturnType<typeof submitBindingFlow>;
  try {
    result = submitBindingFlow(user, requirementId, barcodes, approverId, webUrl);
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  workflowSuccessRedirect(formData, `/trial/${result.requestId}`, `绑定电子流已提交：${result.flowNo}，等待 ${result.approverName} 审批。`,
    actionListState(formData), `binding-barcodes-${result.flowId}`);
}

export async function cancelBindingFlowAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await actionUser();
  const flowId = numberValue(formData, "flowId");
  if (!flowId) return { error: "绑定电子流参数无效。" };
  let result: ReturnType<typeof cancelBindingFlow>;
  try {
    result = cancelBindingFlow(user, flowId, text(formData, "reason"));
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  workflowSuccessRedirect(formData, `/trial/${result.requestId}`,
    result.returnedToBinding ? "绑定电子流已撤销，节点需重新确认，版本已回到绑定验证。" : "绑定电子流已撤销。",
    actionListState(formData), `binding-node-${result.requirementId}`);
}

export async function decideBindingFlowAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await actionUser();
  const flowId = numberValue(formData, "flowId");
  const decision = text(formData, "decision");
  if (!flowId) return { error: "绑定电子流参数无效。" };
  if (decision !== "APPROVED" && decision !== "REJECTED") return { error: "请选择审批结论。" };
  let result: ReturnType<typeof decideBindingFlow>;
  try {
    result = decideBindingFlow(user, flowId, decision, text(formData, "comment"));
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  workflowSuccessRedirect(
    formData,
    `/trial/${result.requestId}`,
    decision === "APPROVED" ? "绑定电子流审批通过。请按当前节点的条码进度继续。" : "绑定电子流已驳回，提交人将收到通知。",
    actionListState(formData),
    decision === "APPROVED" ? `binding-node-${result.requirementId}` : `binding-flow-${flowId}`,
  );
}

export async function releaseFormalAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await actionUser();
  const requestId = numberValue(formData, "requestId");
  if (!requestId) return { error: "项目版本参数无效。" };
  let versionId: number;
  try {
    versionId = releaseFormal(user, requestId, text(formData, "flowNo"), text(formData, "reviewMinutes"));
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  workflowSuccessRedirect(formData, `/versions/${versionId}`, "该软件包全部使用项目已同步发布正式版本。", { ...actionListState(formData), from: "formal" });
}
