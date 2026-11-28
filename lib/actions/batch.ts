"use server";

import { actionUser, failure, idList, numberValue, raw, refreshAll, text } from "@/lib/action-helpers";
import type { ActionState } from "@/lib/action-state";
import { DRAFT_CREATED_MESSAGE, draftRequestListState } from "@/lib/batch-preparation";
import {
  addBatchProgress,
  completeBatchTest,
  createBatchDraft,
  type CreateBatchInput,
  deleteDraftBatch,
  sendBatch,
  terminateBatch,
} from "@/lib/batch-workflow";
import { DomainError } from "@/lib/domain-error";
import { isBatchConclusion } from "@/lib/integration-conclusion";
import { actionListState, workflowSuccessRedirect } from "./workflow-navigation";

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
