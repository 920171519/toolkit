import "server-only";

import { all, one } from "./db";
import type { SessionUser } from "./types";

export function isAreaProjectLead(userId: number, areaId: number | null): boolean {
  if (!areaId) return false;
  const row = one<{ id: number }>(
    "SELECT id FROM area_project_leads WHERE area_id = ? AND user_id = ? LIMIT 1",
    areaId,
    userId,
  );
  return Boolean(row);
}

export function isAreaLeader(userId: number, areaId: number | null): boolean {
  if (!areaId) return false;
  const row = one<{ id: number }>(
    "SELECT id FROM area_leaders WHERE area_id = ? AND user_id = ? LIMIT 1",
    areaId,
    userId,
  );
  return Boolean(row);
}

export function isAreaProjectLeadForProject(
  userId: number,
  areaId: number,
  projectId: number,
): boolean {
  const row = one<{ id: number }>(
    "SELECT id FROM area_project_leads WHERE area_id = ? AND project_id = ? AND user_id = ? LIMIT 1",
    areaId,
    projectId,
    userId,
  );
  return Boolean(row);
}

export function isAreaProjectMember(
  userId: number,
  areaId: number,
  projectId: number,
): boolean {
  const row = one<{ id: number }>(
    "SELECT id FROM area_project_members WHERE area_id = ? AND project_id = ? AND user_id = ? LIMIT 1",
    areaId,
    projectId,
    userId,
  );
  return Boolean(row);
}

export function getIntegrationDuty(userId: number, projectId: number): {
  areaId: number;
  isLeader: boolean;
  isProjectLead: boolean;
} | null {
  const area = one<{ id: number }>("SELECT id FROM areas WHERE is_integration = 1 ORDER BY id LIMIT 1");
  if (!area) return null;
  return {
    areaId: area.id,
    isLeader: isAreaLeader(userId, area.id),
    isProjectLead: isAreaProjectLeadForProject(userId, area.id, projectId),
  };
}

export function canSubmitIntegrationConclusionForProject(user: SessionUser | null, projectId: number): boolean {
  if (!user) return false;
  if (user.role === "ADMIN") return true;
  const duty = getIntegrationDuty(user.id, projectId);
  return Boolean(duty?.isLeader || duty?.isProjectLead);
}

export function getIntegrationManagedProjectIds(userId: number): number[] {
  return all<{ project_id: number }>(
    `SELECT DISTINCT apl.project_id FROM area_project_leads apl
     JOIN areas a ON a.id = apl.area_id
     WHERE a.is_integration = 1 AND apl.user_id = ?
     UNION
     SELECT p.id AS project_id FROM areas a JOIN projects p ON 1 = 1
     JOIN area_leaders al ON al.area_id = a.id
     WHERE a.is_integration = 1 AND al.user_id = ?`,
    userId,
    userId,
  ).map((row) => row.project_id);
}

export function canEditPackageResponsibility(
  user: SessionUser | null,
  packageAreaId: number | null,
): boolean {
  if (!user) return false;
  if (user.role === "ADMIN") return true;
  if (packageAreaId && isAreaLeader(user.id, packageAreaId)) return true;
  return isAreaProjectLead(user.id, packageAreaId);
}

export function canEditPackageById(
  user: SessionUser | null,
  packageId: number,
): boolean {
  if (!user) return false;
  if (user.role === "ADMIN") return true;
  const row = one<{ area_id: number | null }>(
    "SELECT area_id FROM packages WHERE id = ?",
    packageId,
  );
  return canEditPackageResponsibility(user, row?.area_id ?? null);
}


export function hasAreaLeadership(userId: number): boolean {
  const leader = one<{ id: number }>("SELECT id FROM area_leaders WHERE user_id = ? LIMIT 1", userId);
  if (leader) return true;
  const projectLead = one<{ id: number }>(
    "SELECT id FROM area_project_leads WHERE user_id = ? LIMIT 1",
    userId,
  );
  return Boolean(projectLead);
}

export function canManagePackageArea(user: SessionUser | null, areaId: number | null): boolean {
  if (!user) return false;
  if (user.role === "ADMIN") return true;
  return areaId !== null && isAreaLeader(user.id, areaId);
}

export function getLedAreaIds(userId: number): number[] {
  return all<{ areaId: number }>(
    "SELECT area_id AS areaId FROM area_leaders WHERE user_id = ? ORDER BY area_id",
    userId,
  ).map((row) => row.areaId);
}
