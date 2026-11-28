"use server";

import { actionUser, failure, numberValue, refreshAll, successRedirect, text } from "@/lib/action-helpers";
import type { ActionState } from "@/lib/action-state";
import { abandonTrialRelease, releaseFormal, releaseTrial, voidPackageVersion } from "@/lib/release-workflow";
import { directoryActionHref } from "@/lib/settings-directory";
import { readTraceListState, traceListParams } from "@/lib/version-trace-list";
import { hasVersionRequest } from "@/lib/version-void";
import { actionListState, workflowSuccessRedirect } from "./workflow-navigation";

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
