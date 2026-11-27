import type { SessionUser } from "./types";

export function isAdmin(user: SessionUser | null): boolean {
  return user?.role === "ADMIN";
}

export function isBindingOpen(status: string): boolean {
  return status === "TRIAL" || status === "PENDING_FORMAL";
}

export function canSubmitBindingFlow(
  user: SessionUser | null,
  bindingOwnerId: number | null,
): boolean {
  if (!user) return false;
  return isAdmin(user) || user.id === bindingOwnerId;
}

export function canApproveBindingFlow(
  user: SessionUser | null,
  approverId: number | null,
): boolean {
  if (!user) return false;
  return isAdmin(user) || user.id === approverId;
}

export function canManageAreas(user: SessionUser | null): boolean {
  return isAdmin(user);
}
