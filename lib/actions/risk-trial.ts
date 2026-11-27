import "server-only";

import { actionUser, failure, refreshAll, successRedirect, text } from "@/lib/action-helpers";
import type { ActionState } from "@/lib/action-state";
import { safeOverviewReturnPath } from "@/lib/return-to";
import type { RiskTrialEntry } from "@/lib/trial-eligibility";
import { workflowHref } from "@/lib/workflow-links";
import { admitRiskTrial } from "@/lib/workflow";

export async function registerRiskTrial(
  expected: Pick<RiskTrialEntry, "requestId" | "stage" | "batchId">,
  formData: FormData,
): Promise<ActionState> {
  const user = await actionUser();
  let projectId: number;
  try {
    const result = admitRiskTrial(user, {
      ...expected,
      batchId: expected.batchId ?? undefined,
      reason: text(formData, "reason"),
    });
    projectId = result.projectId;
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  const returnTo = safeOverviewReturnPath(text(formData, "returnTo"));
  successRedirect(workflowHref("/trial", projectId, { returnTo }), "风险试制原因已登记，版本已纳入待发布试制。");
}
