import "server-only";

import { all, one } from "./db";
import type { SessionUser } from "./types";
import { STANDALONE_VERSION_HISTORY_IN_PROJECT_SQL } from "./version-scope";

function isAreaProjectLead(userId: number, areaId: number | null): boolean {
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

function getIntegrationDuty(userId: number, projectId: number): {
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

export function getProjectSoftwareManagerIds(projectId: number): number[] {
  return all<{ userId: number }>(
    "SELECT user_id AS userId FROM project_software_managers WHERE project_id = ? ORDER BY user_id",
    projectId,
  ).map((row) => row.userId);
}

function isProjectSoftwareManager(userId: number, projectId: number): boolean {
  return Boolean(
    one<{ id: number }>(
      "SELECT 1 AS id FROM project_software_managers WHERE project_id = ? AND user_id = ? LIMIT 1",
      projectId,
      userId,
    ),
  );
}

export function canManageProjectWorkflowForProject(user: SessionUser | null, projectId: number): boolean {
  if (!user) return false;
  if (user.role === "ADMIN") return true;
  return isProjectSoftwareManager(user.id, projectId);
}

export function canConfirmBindingNodeForProject(
  user: SessionUser,
  packageOwnerId: number | null,
  projectId: number,
): boolean {
  return user.id === packageOwnerId || canManageProjectWorkflowForProject(user, projectId);
}

export function getManagedProjectScope(
  user: SessionUser,
  { includeArchived = false }: { includeArchived?: boolean } = {},
): number[] | null {
  if (user.role === "ADMIN") return null;
  return all<{ projectId: number }>(
    `SELECT psm.project_id AS projectId FROM project_software_managers psm
     ${includeArchived ? "" : "JOIN projects p ON p.id = psm.project_id"}
     WHERE psm.user_id = ? ${includeArchived ? "" : "AND p.status != 'ARCHIVED'"}
     ORDER BY ${includeArchived ? "psm.project_id" : "p.sort_order"}`,
    user.id,
  ).map((row) => row.projectId);
}

export function getLedAreaIds(userId: number): number[] {
  return all<{ areaId: number }>(
    "SELECT area_id AS areaId FROM area_leaders WHERE user_id = ? ORDER BY area_id",
    userId,
  ).map((row) => row.areaId);
}

export function getTransferAreaIds(user: SessionUser): number[] | null {
  if (user.role === "ADMIN") return null;
  return all<{ areaId: number }>(
    `SELECT area_id AS areaId FROM area_leaders WHERE user_id = ?
     UNION SELECT area_id FROM area_project_leads WHERE user_id = ?
     UNION SELECT area_id FROM area_project_members WHERE user_id = ?`,
    user.id,
    user.id,
    user.id,
  ).map((row) => row.areaId);
}

export function canSubmitTransferForArea(user: SessionUser, areaId: number | null): boolean {
  const areaIds = getTransferAreaIds(user);
  return areaIds === null || (areaId !== null && areaIds.includes(areaId));
}

export function canAccessProjectPage(user: SessionUser | null, projectId: number): boolean {
  if (!user) return false;
  const projectIds = getProjectWorkflowProjectIds(user, true);
  return projectIds === null || projectIds.includes(projectId);
}

export function getProjectWorkflowProjectIds(user: SessionUser, includeArchived = false): number[] | null {
  if (user.role === "ADMIN") return null;
  return all<{ id: number }>(
    `SELECT p.id FROM projects p
     WHERE (? OR p.status != 'ARCHIVED')
       AND (p.id IN (
         SELECT project_id FROM project_software_managers WHERE user_id = ?
         UNION SELECT apl.project_id FROM area_project_leads apl JOIN areas a ON a.id = apl.area_id
           WHERE apl.user_id = ? AND a.is_integration = 1
         UNION SELECT apm.project_id FROM area_project_members apm JOIN areas a ON a.id = apm.area_id
           WHERE apm.user_id = ? AND a.is_integration = 1
       ) OR EXISTS (
         SELECT 1 FROM area_leaders al JOIN areas a ON a.id = al.area_id WHERE al.user_id = ? AND a.is_integration = 1
       ))`,
    includeArchived ? 1 : 0, user.id, user.id, user.id, user.id,
  ).map(({ id }) => id);
}

const draftBatchStatus = "DRAFT";

export function getBatchEvidenceReadScope(user: SessionUser) {
  return {
    projectIds: getProjectWorkflowProjectIds(user, true),
    managedProjectIds: getManagedProjectScope(user, { includeArchived: true }),
  };
}

export function canReadBatchEvidence(
  user: SessionUser,
  projectId: number,
  status: string | null,
  scope?: ReturnType<typeof getBatchEvidenceReadScope>,
): boolean {
  const draft = status === draftBatchStatus;
  if (!scope) {
    return draft ? canManageProjectWorkflowForProject(user, projectId) : canAccessProjectPage(user, projectId);
  }
  const ids = draft ? scope.managedProjectIds : scope.projectIds;
  return ids === null || ids.includes(projectId);
}

const batchEvidenceScopeCtes = `readable_projects AS (SELECT value AS id FROM json_each(?)),
  managed_projects AS (SELECT value AS id FROM json_each(?))`;

// Restrict stored batch rows to real workflow projects, including when testing draft evidence.
const batchEvidenceInScopeSql = `b.project_id IN (SELECT id FROM readable_projects)
  AND (b.status != '${draftBatchStatus}' OR b.project_id IN (SELECT id FROM managed_projects))`;

function batchEvidenceScopeSqlParams(user: SessionUser) {
  const { projectIds, managedProjectIds } = getBatchEvidenceReadScope(user);
  return [JSON.stringify(projectIds), JSON.stringify(managedProjectIds)];
}

export function getReadableBatchEvidenceIds(user: SessionUser, batchIds: readonly number[]): Set<number> | null {
  if (user.role === "ADMIN") return null;
  if (batchIds.length === 0) return new Set();
  return new Set(all<{ id: number }>(
    `WITH ${batchEvidenceScopeCtes}
     SELECT b.id FROM integration_batches b
     WHERE b.id IN (SELECT value FROM json_each(?)) AND ${batchEvidenceInScopeSql}`,
    ...batchEvidenceScopeSqlParams(user), JSON.stringify(batchIds),
  ).map(({ id }) => id));
}

const bindingReadAssignment = `(br.binding_owner_id = ? AND br.pushed_at IS NOT NULL)
  OR EXISTS (SELECT 1 FROM binding_flows f WHERE f.requirement_id = br.id AND (f.approver_id = ? OR f.submitted_by = ?))`;

export function getAssignedTrialRequestIds(user: SessionUser): number[] {
  return all<{ id: number }>(
    `SELECT r.id FROM version_transfer_requests r JOIN package_versions pv ON pv.id = r.package_version_id
     JOIN packages p ON p.id = pv.package_id
     WHERE r.status = 'TRIAL' AND (p.owner_id = ? OR EXISTS (
       SELECT 1 FROM binding_requirements br WHERE br.request_id = r.id AND (${bindingReadAssignment})
     ))`, user.id, user.id, user.id, user.id,
  ).map(({ id }) => id);
}

export function getReadableVersionIds(user: SessionUser): number[] | null {
  if (user.role === "ADMIN") return null;
  return all<{ id: number }>(
    `WITH ${batchEvidenceScopeCtes},
          package_assignments AS (
            SELECT area_id, project_id FROM area_project_leads WHERE user_id = ?
            UNION SELECT area_id, project_id FROM area_project_members WHERE user_id = ?
          )
     SELECT pv.id FROM package_versions pv JOIN packages p ON p.id = pv.package_id
     WHERE p.owner_id = ? OR pv.submitted_by = ? OR p.area_id IN (SELECT area_id FROM area_leaders WHERE user_id = ?)
       OR EXISTS (
         SELECT 1 FROM version_transfer_requests r WHERE r.package_version_id = pv.id
           AND (r.project_id IN (SELECT id FROM readable_projects)
             OR EXISTS (SELECT 1 FROM package_assignments duty WHERE duty.area_id = p.area_id AND duty.project_id = r.project_id))
       ) OR EXISTS (
         SELECT 1 FROM batch_items bi JOIN integration_batches b ON b.id = bi.batch_id
         WHERE bi.package_version_id = pv.id AND ${batchEvidenceInScopeSql}
       ) OR EXISTS (SELECT 1 FROM readable_projects visible WHERE ${STANDALONE_VERSION_HISTORY_IN_PROJECT_SQL.replace("?", "visible.id")})
       OR EXISTS (SELECT 1 FROM package_assignments duty WHERE duty.area_id = p.area_id
         AND ${STANDALONE_VERSION_HISTORY_IN_PROJECT_SQL.replace("?", "duty.project_id")})
       OR EXISTS (
         SELECT 1 FROM binding_requirements br WHERE br.package_version_id = pv.id
           AND (${bindingReadAssignment})
       )`,
    ...batchEvidenceScopeSqlParams(user), user.id, user.id, user.id, user.id, user.id, user.id, user.id, user.id,
  ).map(({ id }) => id);
}

export function getReadablePackageIds(user: SessionUser, versionIds = getReadableVersionIds(user)): number[] | null {
  if (versionIds === null) return null;
  return all<{ id: number }>(
    `SELECT p.id FROM packages p
     WHERE p.owner_id = ? OR p.area_id IN (SELECT area_id FROM area_leaders WHERE user_id = ?)
       OR EXISTS (SELECT 1 FROM package_usages pu WHERE pu.package_id = p.id AND (
         pu.project_id IN (SELECT value FROM json_each(?))
         OR EXISTS (SELECT 1 FROM area_project_leads duty WHERE duty.user_id = ? AND duty.area_id = p.area_id AND duty.project_id = pu.project_id)
         OR EXISTS (SELECT 1 FROM area_project_members duty WHERE duty.user_id = ? AND duty.area_id = p.area_id AND duty.project_id = pu.project_id)
       ))
       OR EXISTS (SELECT 1 FROM package_versions v WHERE v.package_id = p.id AND v.id IN (SELECT value FROM json_each(?)))`,
    user.id, user.id, JSON.stringify(getProjectWorkflowProjectIds(user, true)), user.id, user.id, JSON.stringify(versionIds),
  ).map(({ id }) => id);
}

export function canReadPackageWorkflow(user: SessionUser, packageId: number, projectId?: number): boolean {
  if (projectId !== undefined && !canAccessProjectPage(user, projectId)) return false;
  const packageIds = getReadablePackageIds(user);
  return packageIds === null || packageIds.includes(packageId);
}

export function getNarrowVersionRequestIds(user: SessionUser, versionId?: number): number[] {
  const scope = versionId === undefined ? "COALESCE(r.integration_status, r.status) = 'PENDING'" : "r.package_version_id = ?";
  return all<{ id: number }>(
    `SELECT r.id FROM version_transfer_requests r JOIN package_versions pv ON pv.id = r.package_version_id
     JOIN packages p ON p.id = pv.package_id
     WHERE ${scope} AND (
       p.owner_id = ? OR pv.submitted_by = ?
       OR EXISTS (SELECT 1 FROM area_leaders duty WHERE duty.area_id = p.area_id AND duty.user_id = ?)
       OR EXISTS (SELECT 1 FROM area_project_leads duty WHERE duty.area_id = p.area_id AND duty.project_id = r.project_id AND duty.user_id = ?)
       OR EXISTS (SELECT 1 FROM area_project_members duty WHERE duty.area_id = p.area_id AND duty.project_id = r.project_id AND duty.user_id = ?)
       OR EXISTS (SELECT 1 FROM binding_requirements br WHERE br.request_id = r.id AND (${bindingReadAssignment}))
     )`, ...(versionId === undefined ? [] : [versionId]), user.id, user.id, user.id, user.id, user.id, user.id, user.id, user.id,
  ).map(({ id }) => id);
}
