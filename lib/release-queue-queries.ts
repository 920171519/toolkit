import "server-only";

import { canManageProjectWorkflowForProject, getProjectWorkflowProjectIds, type LinkedBatchEvidence } from "./access";
import type { TrialQueueBindingCounts } from "./binding-queries";
import { all, one } from "./db";
import { LATEST_TRANSFER_REQUEST_BATCH_ID_SQL, transferRequestProjectScope } from "./transfer-requests";
import { TRIAL_RELEASE_OVERDUE_SQL } from "./trial-readiness";
import type { SessionUser } from "./types";

export type TrialVersionRow = LinkedBatchEvidence & TrialQueueBindingCounts & {
  requestId: number;
  versionId: number;
  projectId: number;
  projectName: string;
  projectCode: string;
  packageId: number;
  packageName: string;
  packageCode: string;
  version: string;
  trialFormNo: string | null;
  trialReleasedAt: string | null;
  submittedByName: string | null;
  archiveUrl: string;
  changeSummary: string;
  ownerName: string | null;
  softwareManagerName: string | null;
  softwareManagerId: number | null;
  releaseMode: "INTEGRATION" | "RISK";
  riskConclusion: string | null;
  bindingMode: "PENDING" | "PUSHED" | "SKIPPED";
  bindingReason: string | null;
  trialOverdueDays: number;
  isOverdue: number;
};

const versionRequestFrom = `FROM version_transfer_requests r
  JOIN package_versions pv ON pv.id = r.package_version_id
  JOIN projects pr ON pr.id = r.project_id`;
const versionRequestWithPackageFrom = `${versionRequestFrom}
  JOIN packages p ON p.id = pv.package_id`;
const activeReleaseStage = "pr.status != 'ARCHIVED' AND r.status = pv.status";

function trialQueueScope(projectIds: number[] | null, assignedRequestIds: number[]) {
  const activeTrial = `${activeReleaseStage} AND pv.status = 'TRIAL'`;
  if (projectIds === null) return { where: activeTrial, params: [] };
  return {
    where: `${activeTrial} AND (r.project_id IN (SELECT value FROM json_each(?)) OR r.id IN (SELECT value FROM json_each(?)))`,
    params: [JSON.stringify(projectIds), JSON.stringify(assignedRequestIds)],
  };
}

export function getTrialVersionCount(projectIds: number[] | null, assignedRequestIds: number[]): number {
  const { where, params } = trialQueueScope(projectIds, assignedRequestIds);
  return one<{ total: number }>(`SELECT COUNT(*) AS total ${versionRequestFrom} WHERE ${where}`, ...params)?.total ?? 0;
}

export function getProjectTrialAndFormalCounts(projectId: number) {
  const rows = all<{ status: "TRIAL" | "PENDING_FORMAL"; total: number; overdue: number }>(
    `SELECT r.status, COUNT(*) AS total, COUNT(*) FILTER (WHERE ${TRIAL_RELEASE_OVERDUE_SQL}) AS overdue
     ${versionRequestWithPackageFrom}
     WHERE r.project_id = ? AND ${activeReleaseStage} AND r.status IN ('TRIAL','PENDING_FORMAL')
     GROUP BY r.status`,
    projectId,
  );
  const byStatus = Object.fromEntries(rows.map(({ status, ...counts }) => [status, counts]));
  const empty = { total: 0, overdue: 0 };
  return { binding: byStatus.TRIAL ?? empty, formal: byStatus.PENDING_FORMAL ?? empty };
}

export function getTrialVersions(projectIds: number[] | null = null, assignedRequestIds: number[] = []): TrialVersionRow[] {
  const { where, params } = trialQueueScope(projectIds, assignedRequestIds);
  return all<TrialVersionRow>(
      `SELECT r.id AS requestId, pv.id AS versionId, pr.id AS projectId, pr.name AS projectName,
              pr.code AS projectCode, p.id AS packageId, p.name AS packageName, p.code AS packageCode,
              pv.version, r.trial_form_no AS trialFormNo, r.trial_released_at AS trialReleasedAt,
              su.name AS submittedByName, pv.archive_url AS archiveUrl, pv.change_summary AS changeSummary, o.name AS ownerName,
              sm.name AS softwareManagerName, pr.software_manager_id AS softwareManagerId,
              r.release_mode AS releaseMode, r.risk_conclusion AS riskConclusion,
              pv.binding_mode AS bindingMode, pv.binding_reason AS bindingReason,
              p.trial_overdue_days AS trialOverdueDays,
              CASE WHEN ${TRIAL_RELEASE_OVERDUE_SQL} THEN 1 ELSE 0 END AS isOverdue,
              b.id AS batchId, b.code AS batchCode, b.project_id AS batchProjectId, b.status AS batchStatus, b.conclusion AS batchConclusion,
              (SELECT COUNT(*) FROM binding_requirements br WHERE br.request_id = r.id) AS requirementTotal,
              (SELECT COUNT(*) FROM binding_requirements br WHERE br.request_id = r.id AND br.status = 'PASSED'
               AND br.confirmed_at IS NOT NULL) AS requirementPassed,
              (SELECT COUNT(*) FROM binding_requirements br WHERE br.request_id = r.id AND br.waived_at IS NOT NULL) AS requirementWaived,
              (SELECT COUNT(*) FROM binding_flows f WHERE f.requirement_id IN (SELECT id FROM binding_requirements WHERE request_id = r.id) AND f.status = 'PENDING') AS pendingFlowCount
       ${versionRequestWithPackageFrom}
       LEFT JOIN users su ON su.id = pv.submitted_by
       LEFT JOIN users o ON o.id = p.owner_id
       LEFT JOIN users sm ON sm.id = pr.software_manager_id
       LEFT JOIN integration_batches b ON b.id = ${LATEST_TRANSFER_REQUEST_BATCH_ID_SQL}
       WHERE ${where}
       ORDER BY r.trial_released_at DESC, r.id DESC`,
    ...params,
  ).map((version) => ({
    ...version,
    requirementTotal: Number(version.requirementTotal),
    requirementPassed: Number(version.requirementPassed),
    requirementWaived: Number(version.requirementWaived),
    pendingFlowCount: Number(version.pendingFlowCount),
  }));
}

export function getManagedTrialRequestState(user: SessionUser, requestId: number, projectId?: number) {
  const request = one<{
    versionId: number;
    projectId: number;
    trialReleasedAt: string | null;
    versionStatus: string;
    projectStatus: string;
  }>(
    `SELECT r.package_version_id AS versionId, r.project_id AS projectId, r.trial_released_at AS trialReleasedAt,
            pv.status AS versionStatus, p.status AS projectStatus
     FROM version_transfer_requests r JOIN package_versions pv ON pv.id = r.package_version_id
     JOIN projects p ON p.id = r.project_id WHERE r.id = ?`,
    requestId,
  );
  if (!request || (projectId !== undefined && projectId !== request.projectId)) return null;
  return canManageProjectWorkflowForProject(user, request.projectId) ? request : null;
}

// Archived requests still provide a history landing when the last project leaves the formal queue.
export function hasReadableFormalHistory(user: SessionUser, versionId: number, projectId?: number): boolean {
  const readableProjects = getProjectWorkflowProjectIds(user, true);
  if (projectId !== undefined && readableProjects !== null && !readableProjects.includes(projectId)) return false;
  const scope = projectId === undefined ? readableProjects : [projectId];
  return Boolean(one(
    `SELECT 1 FROM version_transfer_requests
     WHERE package_version_id = ? AND trial_released_at IS NOT NULL
     ${scope === null ? "" : "AND project_id IN (SELECT value FROM json_each(?))"} LIMIT 1`,
    versionId,
    ...(scope === null ? [] : [JSON.stringify(scope)]),
  ));
}

export type PendingFormalVersion = {
  requestId: number;
  versionId: number;
  projectId: number;
  projectName: string;
  projectCode: string;
  packageId: number;
  packageName: string;
  packageCode: string;
  version: string;
  changeSummary: string;
  archiveUrl: string;
  trialFormNo: string | null;
  trialReleasedAt: string | null;
  bindingMode: "PENDING" | "PUSHED" | "SKIPPED";
  releaseMode: "INTEGRATION" | "RISK";
  ownerName: string | null;
  softwareManagerName: string | null;
  softwareManagerId: number | null;
  requirementTotal: number;
  requirementPassed: number;
  requirementWaived: number;
  trialOverdueDays: number;
  isOverdue: number;
};

const pendingFormalOrder = "ORDER BY r.trial_released_at DESC, r.id DESC";

function pendingFormalScope(projectIds: number[] | null, versionId?: number) {
  if (projectIds?.length === 0) return null;
  const scope = transferRequestProjectScope(projectIds);
  return {
    where: `${activeReleaseStage} AND pv.status = 'PENDING_FORMAL'
      ${versionId === undefined ? "" : "AND pv.id = ?"} ${scope.predicate}`,
    params: [...(versionId === undefined ? [] : [versionId]), ...scope.params],
  };
}

type WorkbenchPendingFormalVersion = Pick<PendingFormalVersion,
  "versionId" | "projectId" | "projectName" | "packageName" | "packageCode" | "version">;

export function getWorkbenchPendingFormalRows(projectIds: number[] | null): WorkbenchPendingFormalVersion[] {
  const scope = pendingFormalScope(projectIds);
  if (!scope) return [];
  return all<WorkbenchPendingFormalVersion>(
    `SELECT pv.id AS versionId, pr.id AS projectId, pr.name AS projectName,
            p.name AS packageName, p.code AS packageCode, pv.version
     ${versionRequestWithPackageFrom}
     WHERE ${scope.where}
     ${pendingFormalOrder}`,
    ...scope.params,
  );
}

export function getPendingFormalVersions(projectIds: number[] | null = null, versionId?: number): PendingFormalVersion[] {
  const scope = pendingFormalScope(projectIds, versionId);
  if (!scope) return [];
  return all<PendingFormalVersion>(
    `SELECT r.id AS requestId, pv.id AS versionId, pr.id AS projectId, pr.name AS projectName,
            pr.code AS projectCode, p.id AS packageId, p.name AS packageName, p.code AS packageCode,
            pv.version, pv.change_summary AS changeSummary, pv.archive_url AS archiveUrl,
            r.trial_form_no AS trialFormNo, r.trial_released_at AS trialReleasedAt,
            pv.binding_mode AS bindingMode, r.release_mode AS releaseMode,
            o.name AS ownerName, sm.name AS softwareManagerName, pr.software_manager_id AS softwareManagerId,
            p.trial_overdue_days AS trialOverdueDays,
            CASE WHEN ${TRIAL_RELEASE_OVERDUE_SQL} THEN 1 ELSE 0 END AS isOverdue,
            (SELECT COUNT(*) FROM binding_requirements br WHERE br.request_id = r.id) AS requirementTotal,
            (SELECT COUNT(*) FROM binding_requirements br WHERE br.request_id = r.id AND br.status = 'PASSED'
             AND br.confirmed_at IS NOT NULL) AS requirementPassed,
            (SELECT COUNT(*) FROM binding_requirements br WHERE br.request_id = r.id AND br.waived_at IS NOT NULL) AS requirementWaived
     ${versionRequestWithPackageFrom}
     LEFT JOIN users o ON o.id = p.owner_id
     LEFT JOIN users sm ON sm.id = pr.software_manager_id
     WHERE ${scope.where}
     ${pendingFormalOrder}`,
    ...scope.params,
  ).map((version) => ({
    ...version,
    requirementTotal: Number(version.requirementTotal),
    requirementPassed: Number(version.requirementPassed),
    requirementWaived: Number(version.requirementWaived),
  }));
}

export function getVersionRequestIds(versionId: number): number[] {
  return all<{ id: number }>(
    `SELECT r.id FROM version_transfer_requests r
     JOIN projects pr ON pr.id = r.project_id
     WHERE r.package_version_id = ? AND pr.status != 'ARCHIVED'
     ORDER BY pr.sort_order`,
    versionId,
  ).map((row) => row.id);
}
