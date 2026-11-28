"use server";

import { actionUser, failure, numberValue, refreshAll, text } from "@/lib/action-helpers";
import type { ActionState } from "@/lib/action-state";
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
import { parseBindingBarcodeText } from "@/lib/binding-barcode-results";
import { DomainError } from "@/lib/domain-error";
import { actionListState, workflowSuccessRedirect } from "./workflow-navigation";

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

export async function submitBindingFlowAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await actionUser();
  const requirementId = numberValue(formData, "requirementId");
  const approverId = numberValue(formData, "approverId");
  if (!requirementId) return { error: "绑定任务参数无效。" };
  if (!approverId) return { error: "请选择绑定电子流审批人。" };
  const rawBarcodes = formData.getAll("barcodes").filter((item): item is string => typeof item === "string").join("\n");
  const barcodes = parseBindingBarcodeText(rawBarcodes);
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
