import type { Role } from "./constants";
import type { SessionUser } from "./types";

const WORKFLOW_ROLES: Role[] = ["ADMIN", "SOFTWARE_MANAGER"];
const REVIEW_ROLES: Role[] = ["ADMIN", "REVIEWER"];
const BINDING_ROLES: Role[] = [
  "ADMIN",
  "SOFTWARE_MANAGER",
  "INTEGRATION_TESTER",
  "TEST_VALIDATOR",
  "PACKAGE_OWNER",
];

export function isAdmin(user: SessionUser | null): boolean {
  return user?.role === "ADMIN";
}

export function canManageWorkflow(user: SessionUser | null): boolean {
  return !!user && WORKFLOW_ROLES.includes(user.role);
}

export function canManageConfig(user: SessionUser | null): boolean {
  return canManageWorkflow(user);
}

export function canReview(user: SessionUser | null): boolean {
  return !!user && REVIEW_ROLES.includes(user.role);
}

export function canValidateBinding(user: SessionUser | null): boolean {
  return !!user && BINDING_ROLES.includes(user.role);
}

export function isBindingOpen(status: string): boolean {
  return status === "TRIAL" || status === "PENDING_FORMAL";
}

export function canSubmitBindingFlow(
  user: SessionUser | null,
  bindingOwnerId: number | null,
): boolean {
  if (!user) return false;
  if (user.role === "ADMIN") return true;
  if (bindingOwnerId !== null && user.id === bindingOwnerId) return true;
  return user.role === "TEST_VALIDATOR";
}

export function canApproveBindingFlow(
  user: SessionUser | null,
  approverId: number | null,
): boolean {
  if (!user) return false;
  if (user.role === "ADMIN") return true;
  return approverId !== null && user.id === approverId;
}

export function canSubmitForPackage(user: SessionUser | null, ownerId: number | null): boolean {
  if (!user) return false;
  if (canManageWorkflow(user)) return true;
  return ownerId !== null && user.id === ownerId;
}

export function canCancelVersion(user: SessionUser | null, submittedById: number | null): boolean {
  if (!user) return false;
  return canManageWorkflow(user) || user.id === submittedById;
}

export function canApproveReview(
  user: SessionUser | null,
  requestedById: number | null,
): boolean {
  if (!canReview(user)) return false;
  return !!user && user.id !== requestedById;
}

export const PERMISSION_HINTS = {
  workflow: "仅系统管理员、软件经理可操作",
  review: "仅评审专家、系统管理员可操作，且不能评审自己发起的申请",
  binding: "仅绑定验证员、集成测试、软件包责任人或管理人员可记录",
  config: "仅系统管理员、软件经理可维护",
};

export function isProjectSoftwareManager(
  user: SessionUser | null,
  softwareManagerId: number | null,
): boolean {
  return !!user && softwareManagerId !== null && user.id === softwareManagerId;
}

export function canManageProjectWorkflow(
  user: SessionUser | null,
  softwareManagerId: number | null,
): boolean {
  if (!user) return false;
  if (user.role === "ADMIN") return true;
  return isProjectSoftwareManager(user, softwareManagerId);
}

export function canManageAreas(user: SessionUser | null): boolean {
  return user?.role === "ADMIN";
}

export function canManageAreaProjectLeads(
  user: SessionUser | null,
  isAreaLeader: boolean,
): boolean {
  if (!user) return false;
  if (user.role === "ADMIN") return true;
  return isAreaLeader;
}

export function canManageAreaProjectMembers(
  user: SessionUser | null,
  isAreaLeader: boolean,
  isProjectLead: boolean,
): boolean {
  if (!user) return false;
  if (user.role === "ADMIN") return true;
  return isAreaLeader || isProjectLead;
}

export function canSubmitIntegrationConclusion(
  user: SessionUser | null,
  isIntegrationAreaLeader: boolean,
  isIntegrationProjectLead: boolean,
): boolean {
  if (!user) return false;
  if (user.role === "ADMIN") return true;
  return isIntegrationAreaLeader || isIntegrationProjectLead;
}
