"use server";

import { actionUser, failure, numberValue, refreshAll, text } from "@/lib/action-helpers";
import type { ActionState } from "@/lib/action-state";
import { cancelTransfer, submitTransfer } from "@/lib/transfer-workflow";
import { actionListState, workflowSuccessRedirect } from "./workflow-navigation";

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
