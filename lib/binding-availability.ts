const bindingReleaseStatuses: readonly string[] = ["TRIAL", "PENDING_FORMAL"];
const bindingRequirementStatuses: readonly string[] = ["PENDING", "PASSED"];

export const OPEN_BINDING_RELEASE_STATUSES_SQL = `(${bindingReleaseStatuses.map((status) => `'${status}'`).join(",")})`;
export const OPEN_BINDING_REQUIREMENT_STATUSES_SQL = `(${bindingRequirementStatuses.map((status) => `'${status}'`).join(",")})`;

export function isBindingReleaseOpen(status: string): boolean {
  return bindingReleaseStatuses.includes(status);
}

export type BindingReleaseFacts = {
  projectStatus: string;
  requestStatus: string;
  versionStatus: string;
};

export function bindingReleaseAvailability({ projectStatus, requestStatus, versionStatus }: BindingReleaseFacts): "ARCHIVED" | "CLOSED" | "OPEN" {
  if (projectStatus === "ARCHIVED") return "ARCHIVED";
  return isBindingReleaseOpen(requestStatus) && isBindingReleaseOpen(versionStatus) ? "OPEN" : "CLOSED";
}

export function bindingRequirementAvailability({ status, pushed, waived }: {
  status: string;
  pushed: boolean;
  waived: boolean;
}): "CLOSED" | "UNPUSHED" | "OPEN" {
  if (!bindingRequirementStatuses.includes(status) || waived) return "CLOSED";
  return pushed ? "OPEN" : "UNPUSHED";
}
