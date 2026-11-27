import type { SessionUser } from "./types";

export function isAdmin(user: SessionUser | null): boolean {
  return user?.role === "ADMIN";
}

export function canSubmitBindingFlow(
  user: SessionUser | null,
  bindingOwnerId: number | null,
): boolean {
  if (!user) return false;
  return isAdmin(user) || user.id === bindingOwnerId;
}

export function bindingFlowApprovalBlocker(
  user: SessionUser | null,
  flow: { approverId: number | null; submittedById: number | null },
): "FORBIDDEN" | "SELF_REVIEW" | null {
  if (!user || (!isAdmin(user) && user.id !== flow.approverId)) return "FORBIDDEN";
  return user.id === flow.submittedById ? "SELF_REVIEW" : null;
}

export function canManageAreas(user: SessionUser | null): boolean {
  return isAdmin(user);
}
