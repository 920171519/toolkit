"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import type { ActionState } from "@/lib/action-state";
import { failure, idList, numberValue, raw, successRedirect, text } from "@/lib/action-helpers";
import { one } from "@/lib/db";
import { workflowHref } from "@/lib/workflow-links";
import {
  addBatchProgress,
  cancelBindingFlow,
  cancelTransfer,
  completeBatchTest,
  createBatchDraft,
  decideBindingFlow,
  deleteDraftBatch,
  releaseFormal,
  releaseTrial,
  sendBatch,
  submitBindingFlow,
  submitTransfer,
  terminateBatch,
  abandonTrialRelease,
  pushBindingTasks,
  skipBindingAndEnterFormal,
  voidPackageVersion,
  voidTrial,
  waiveBindingRequirement,
} from "@/lib/workflow";

async function actionUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

function workflowSuccessRedirect(formData: FormData, path: string, message: string): never {
  return successRedirect(workflowHref(path, numberValue(formData, "scopeProjectId")), message);
}

function refreshAll() {
  revalidatePath("/", "layout");
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
  workflowSuccessRedirect(formData, "/submissions", "转测申请已撤回。");
}

export async function createBatchAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await actionUser();
  const projectId = numberValue(formData, "projectId");
  const code = text(formData, "code");
  const title = text(formData, "title");
  if (!projectId) return { error: "请选择项目。" };
  if (!code) return { error: "请填写批次号。" };
  let items: Array<{ packageId: number; packageVersionId: number }> = [];
  try {
    const payload = JSON.parse(text(formData, "items")) as unknown;
    if (!Array.isArray(payload)) throw new Error("invalid items");
    items = payload.map((item) => {
      const record = item as { packageId?: unknown; packageVersionId?: unknown };
      const packageId = Number(record.packageId);
      const packageVersionId = Number(record.packageVersionId);
      if (!Number.isInteger(packageId) || !Number.isInteger(packageVersionId)) throw new Error("invalid item");
      return { packageId, packageVersionId };
    });
  } catch {
    return { error: "配套版本选择已失效，请刷新页面后重试。" };
  }
  if (items.length === 0) return { error: "请为整套配套选择版本。" };
  try {
    createBatchDraft(user, { projectId, code, title, items });
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  workflowSuccessRedirect(formData, "/submissions", "整套配套转测草稿已创建，请在待转测申请页确认并发起。");
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
  workflowSuccessRedirect(formData, `/integration/${batchId}`, "进展说明已提交。");
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
  workflowSuccessRedirect(formData, "/submissions", "转测草稿已删除。");
}

export async function sendBatchAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await actionUser();
  const batchId = numberValue(formData, "batchId");
  if (!batchId) return { error: "批次参数无效。" };
  try {
    sendBatch(user, batchId);
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  const batch = one<{ code: string }>("SELECT code FROM integration_batches WHERE id = ?", batchId);
  workflowSuccessRedirect(formData, "/submissions", `${batch?.code ?? "批次"} 已发起集成测试，等待本项目集成测试负责人提交结论。`);
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
  workflowSuccessRedirect(formData, `/integration/${batchId}`, "本批次已终止，相关项目转测申请已退回待安排。");
}

export async function completeBatchAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await actionUser();
  const batchId = numberValue(formData, "batchId");
  const conclusion = text(formData, "conclusion");
  const issueAttribution = text(formData, "issueAttribution");
  if (!batchId) return { error: "批次参数无效。" };
  if (!["PASS", "FAIL", "BLOCKED"].includes(conclusion)) return { error: "请选择测试结论。" };
  const uploaded = formData.get("reportFile");
  const reportFile = uploaded instanceof File && uploaded.size > 0 ? uploaded : null;
  if (!reportFile) return { error: "请上传验证报告。" };
  let voidedCount = 0;
  try {
    const result = await completeBatchTest(user, batchId, {
      conclusion: conclusion as "PASS" | "FAIL" | "BLOCKED",
      issueAttribution: issueAttribution as "NONE" | "PACKAGE_RELATED" | "NOT_PACKAGE_RELATED" | "UNKNOWN",
      testSummary: text(formData, "testSummary"),
      reportFile,
      affectedVersionIds: idList(formData, "affectedVersionId"),
    });
    voidedCount = result.voidedCount;
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  workflowSuccessRedirect(formData, `/integration/${batchId}`, voidedCount > 0
    ? `测试结论已提交，${voidedCount} 个受影响的风险试制版本已作废。`
    : "测试结论已提交，验证报告已上传。");
}

export async function releaseTrialAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await actionUser();
  const requestId = numberValue(formData, "requestId");
  if (!requestId) return { error: "项目版本参数无效。" };
  let taskCount = 0;
  try {
    taskCount = releaseTrial(user, requestId, text(formData, "trialFormNo"), text(formData, "riskConclusion"));
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  workflowSuccessRedirect(formData, `/trial/${requestId}`, `试制版本已发布，已生成 ${taskCount} 个节点绑定任务。请先决定是否推送绑定任务。`);
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
  workflowSuccessRedirect(formData, `/trial/${requestId}`, `已向全部使用项目的绑定责任人推送 ${count} 个节点绑定任务。`);
}

export async function skipBindingAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await actionUser();
  const requestId = numberValue(formData, "requestId");
  if (!requestId) return { error: "项目版本参数无效。" };
  let enteredFormal = false;
  try {
    const result = skipBindingAndEnterFormal(user, requestId, text(formData, "reason"));
    enteredFormal = result.enteredFormal;
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  workflowSuccessRedirect(
    formData,
    enteredFormal ? "/formal" : `/trial/${requestId}`,
    enteredFormal ? "已记录不进行绑定验证的原因，全部使用项目进入待转正。" : "已记录无需绑定。关联转测批次结束后再进入待转正。",
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
    result.enteredFormal ? "已登记此节点无需绑定，版本已进入待转正。" : "已登记此节点无需绑定。",
  );
}

export async function abandonTrialReleaseAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await actionUser();
  const requestId = numberValue(formData, "requestId");
  if (!requestId) return { error: "项目版本参数无效。" };
  try {
    abandonTrialRelease(user, requestId, text(formData, "conclusion"));
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  workflowSuccessRedirect(formData, "/trial", "已提交放弃发布试制结论，该版本将不再发布试制。");
}

export async function voidPackageVersionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await actionUser();
  const versionId = numberValue(formData, "versionId");
  if (!versionId) return { error: "版本参数无效。" };
  try {
    voidPackageVersion(user, versionId, text(formData, "reason"));
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  workflowSuccessRedirect(formData, `/versions/${versionId}`, "该软件包版本已作废，不再作为可用版本。");
}

export async function voidTrialAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await actionUser();
  const requestId = numberValue(formData, "requestId");
  if (!requestId) return { error: "项目版本参数无效。" };
  try {
    voidTrial(user, requestId, text(formData, "reason"));
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  workflowSuccessRedirect(formData, "/trial", "共享试制版本已作废，全部项目相关绑定电子流提交人已收到撤回提醒。");
}

export async function submitBindingFlowAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await actionUser();
  const requirementId = numberValue(formData, "requirementId");
  const requestId = numberValue(formData, "requestId");
  const approverId = numberValue(formData, "approverId");
  if (!requirementId || !requestId) return { error: "绑定任务参数无效。" };
  if (!approverId) return { error: "请选择绑定电子流审批人。" };
  const rawBarcodes = formData.getAll("barcodes").filter((item): item is string => typeof item === "string").join("\n");
  const barcodes = rawBarcodes.split(/[\n,，;；]+/).map((barcode) => barcode.trim()).filter(Boolean);
  if (barcodes.length === 0) {
    return { error: "请至少添加一个有效设备条码。" };
  }
  const webUrl = text(formData, "webUrl");
  try {
    submitBindingFlow(user, requirementId, barcodes, approverId, webUrl);
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  workflowSuccessRedirect(formData, `/trial/${requestId}`, "绑定电子流已提交，等待本项目节点审批人审批。");
}

export async function cancelBindingFlowAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await actionUser();
  const flowId = numberValue(formData, "flowId");
  const requestId = numberValue(formData, "requestId");
  if (!flowId || !requestId) return { error: "绑定电子流参数无效。" };
  try {
    cancelBindingFlow(user, flowId, text(formData, "reason"));
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  workflowSuccessRedirect(formData, `/trial/${requestId}`, "绑定电子流已撤销。");
}

export async function decideBindingFlowAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await actionUser();
  const flowId = numberValue(formData, "flowId");
  const requestId = numberValue(formData, "requestId");
  const decision = text(formData, "decision");
  if (!flowId || !requestId) return { error: "绑定电子流参数无效。" };
  if (decision !== "APPROVED" && decision !== "REJECTED") return { error: "请选择审批结论。" };
  let enteredFormal = false;
  try {
    const result = decideBindingFlow(user, flowId, decision, text(formData, "comment"));
    enteredFormal = result.enteredFormal;
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  workflowSuccessRedirect(
    formData,
    enteredFormal ? "/formal" : `/trial/${requestId}`,
    enteredFormal
      ? "绑定电子流已通过，该软件包全部项目节点绑定数量已满足，版本进入待转正。"
      : decision === "APPROVED"
        ? "绑定电子流审批通过。"
        : "绑定电子流已驳回，提交人将收到通知。",
  );
}

export async function releaseFormalAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await actionUser();
  const requestId = numberValue(formData, "requestId");
  if (!requestId) return { error: "项目版本参数无效。" };
  try {
    releaseFormal(user, requestId, text(formData, "flowNo"));
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  workflowSuccessRedirect(formData, "/formal", "该软件包全部使用项目已同步发布正式版本。");
}
