export const ROLES = ["ADMIN", "MEMBER"] as const;
export type Role = (typeof ROLES)[number];

export const PACKAGE_STATUSES = [
  "PENDING_TRANSFER",
  "IN_TEST",
  "PENDING_TRIAL",
  "TRIAL",
  "PENDING_FORMAL",
  "FORMAL",
  "VOID",
] as const;
export type PackageStatus = (typeof PACKAGE_STATUSES)[number];

export const PROJECT_STATUSES = ["ACTIVE", "PAUSED", "ARCHIVED"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export function isProjectStatus(value: unknown): value is ProjectStatus {
  return PROJECT_STATUSES.some((status) => status === value);
}

export const BATCH_STATUSES = ["DRAFT", "IN_TEST", "COMPLETED", "TERMINATED"] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

export const BATCH_CONCLUSIONS = ["PASS", "FAIL", "BLOCKED"] as const;
export type BatchConclusion = (typeof BATCH_CONCLUSIONS)[number];

export const ISSUE_ATTRIBUTIONS = ["NONE", "PACKAGE_RELATED", "NOT_PACKAGE_RELATED", "UNKNOWN"] as const;
export type IssueAttribution = (typeof ISSUE_ATTRIBUTIONS)[number];

export const BINDING_FLOW_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;
export type BindingFlowStatus = (typeof BINDING_FLOW_STATUSES)[number];
