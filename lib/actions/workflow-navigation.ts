import "server-only";

import { redirect } from "next/navigation";
import { numberValue, text } from "@/lib/action-helpers";
import { integrationHistoryParams, readIntegrationHistory } from "@/lib/integration-history";
import { safeOverviewReturnPath } from "@/lib/return-to";
import { trialQueueParams } from "@/lib/trial-queue";
import { workflowHref } from "@/lib/workflow-links";
import { getWorkflowListState } from "@/lib/workflow-list";

export function workflowSuccessRedirect(
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

export function actionListState(formData: FormData) {
  return getWorkflowListState({ q: text(formData, "q"), page: text(formData, "page"), pageSize: text(formData, "pageSize"), returnTo: text(formData, "returnTo") });
}
