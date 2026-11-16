"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import type { ActionState } from "@/lib/action-state";
import { failure, numberValue, raw, successRedirect, text } from "@/lib/action-helpers";
import { one } from "@/lib/db";
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
  voidTrial,
} from "@/lib/workflow";

async function actionUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
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
    });
    projectCount = result.projectCount;
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  successRedirect("/submissions", `转测申请已提交，并发送至 ${projectCount} 个项目。`);
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
  successRedirect("/submissions", "转测申请已撤回。");
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
  successRedirect("/submissions", "整套配套转测草稿已创建，请在待转测申请页确认并发起。");
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
  successRedirect(`/integration/${batchId}`, "进展说明已提交。");
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
  successRedirect("/submissions", "转测草稿已删除。");
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
  successRedirect("/submissions", `${batch?.code ?? "批次"} 已发起集成测试，等待本项目集成测试负责人提交结论。`);
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
  successRedirect(`/integration/${batchId}`, "本批次已终止，相关项目转测申请已退回待安排。");
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
  try {
    await completeBatchTest(user, batchId, {
      conclusion: conclusion as "PASS" | "FAIL" | "BLOCKED",
      issueAttribution: issueAttribution as "NONE" | "PACKAGE_RELATED" | "NOT_PACKAGE_RELATED" | "UNKNOWN",
      testSummary: text(formData, "testSummary"),
      reportFile,
    });
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  successRedirect(`/integration/${batchId}`, "测试结论已提交，验证报告已上传。");
}

export async function releaseTrialAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await actionUser();
  const requestId = numberValue(formData, "requestId");
  if (!requestId) return { error: "项目版本参数无效。" };
  let taskCount = 0;
  try {
    taskCount = releaseTrial(user, requestId, text(formData, "trialFormNo"));
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  successRedirect(`/trial/${requestId}`, `试制版本已发布，已为本项目生成 ${taskCount} 个节点绑定任务。`);
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
  successRedirect("/trial", "试制版本已作废，相关绑定电子流提交人已收到撤回提醒。");
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
  successRedirect(`/trial/${requestId}`, "绑定电子流已提交，等待本项目节点审批人审批。");
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
  successRedirect(`/trial/${requestId}`, "绑定电子流已撤销。");
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
  successRedirect(
    enteredFormal ? "/formal" : `/trial/${requestId}`,
    enteredFormal
      ? "绑定电子流已通过，本项目全部节点绑定数量已满足，版本进入本项目待转正。"
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
  successRedirect("/formal", "本项目正式版本已发布。");
}
