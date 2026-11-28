import { createHash } from "node:crypto";
import { getBatchEvidenceReadScope, getReadableLinkedBatchEvidence } from "./access";
import { all, one } from "./db";
import {
  LATEST_TRANSFER_BATCH_JOIN_SQL,
  LINKED_TRANSFER_BATCH_COLUMNS_SQL,
  TRIAL_PENDING_VERSION_STATUSES_SQL,
  TRIAL_USABLE_REQUEST_STATUSES_SQL,
  type LinkedBatchEvidence,
} from "./transfer-requests";
import { ACTIVE_INTEGRATION_BATCH_COUNT_SQL } from "./trial-readiness";
import type { SessionUser } from "./types";

function trialEligibilityCtes(versionScope = "") {
  return `
    trial_versions AS (
      SELECT id, package_id FROM package_versions
      WHERE status IN ${TRIAL_PENDING_VERSION_STATUSES_SQL} ${versionScope}
    ),
    trial_scope AS (
      SELECT DISTINCT v.id AS versionId, u.project_id AS projectId
      FROM trial_versions v
      JOIN package_usages u ON u.package_id = v.package_id
      JOIN projects p ON p.id = u.project_id AND p.status != 'ARCHIVED'
    ),
    trial_project_evidence AS (
      SELECT s.versionId, s.projectId, r.id AS requestId, r.status AS requestStatus,
             ${LINKED_TRANSFER_BATCH_COLUMNS_SQL},
             r.status IN ${TRIAL_USABLE_REQUEST_STATUSES_SQL} AS usable,
             CASE WHEN r.status = 'PASSED' AND b.status = 'COMPLETED' AND b.conclusion = 'PASS' THEN 1 ELSE 0 END AS passed
      FROM trial_scope s
      LEFT JOIN version_transfer_requests r ON r.package_version_id = s.versionId AND r.project_id = s.projectId
      ${LATEST_TRANSFER_BATCH_JOIN_SQL}
    ),
    trial_totals AS (
      SELECT v.id AS versionId, COUNT(e.projectId) AS versionProjectCount,
             COUNT(e.projectId) - COUNT(e.requestId) AS missingRequestCount,
             COUNT(e.projectId) - COALESCE(SUM(e.usable), 0) AS unavailableRequestCount,
             COUNT(e.projectId) - COALESCE(SUM(e.passed), 0) AS riskProjectCount,
             GROUP_CONCAT(e.projectId || ':' || e.requestId || ':' || e.requestStatus || ':' ||
               COALESCE(e.batchId, '') || ':' || e.passed, ',' ORDER BY e.projectId) AS evidenceKey
      FROM trial_versions v
      LEFT JOIN trial_project_evidence e ON e.versionId = v.id
      GROUP BY v.id
    ),
    trial_eligibility AS (
      SELECT q.*, a.id AS riskAdmissionId, a.reason AS riskConclusion,
             CASE WHEN q.versionProjectCount > 0 AND q.unavailableRequestCount = 0 THEN
               CASE WHEN q.riskProjectCount = 0 THEN 'INTEGRATION'
                    WHEN a.id IS NOT NULL THEN 'RISK' END
             END AS releaseMode
      FROM trial_totals q
      LEFT JOIN trial_risk_admissions a ON a.package_version_id = q.versionId AND a.invalidated_at IS NULL
    )`;
}

type TrialProjectEvidence = LinkedBatchEvidence & {
  projectId: number;
  projectName: string;
  requestId: number | null;
  requestStatus: string | null;
  usable: number | null;
  passed: number;
};

type TrialReleaseState = {
  releaseMode: "INTEGRATION" | "RISK" | null;
  riskProjectCount: number;
  riskAdmissionId: number | null;
  riskConclusion: string | null;
  evidenceKey: string | null;
};

type TrialReleaseEligibility = TrialReleaseState & { projects: TrialProjectEvidence[] };

export function getTrialReleaseEligibility(versionId: number): TrialReleaseEligibility | null {
  const rows = all<TrialReleaseState & (TrialProjectEvidence | { projectId: null })>(
    `WITH ${trialEligibilityCtes("AND id = ?")}
     SELECT q.releaseMode, q.riskProjectCount, q.riskAdmissionId, q.riskConclusion, q.evidenceKey,
            e.projectId, p.name AS projectName, e.requestId, e.requestStatus, e.usable, e.passed,
            e.batchId, e.batchCode, e.batchProjectId, e.batchStatus, e.batchConclusion
     FROM trial_eligibility q
     LEFT JOIN trial_project_evidence e ON e.versionId = q.versionId
     LEFT JOIN projects p ON p.id = e.projectId
     ORDER BY p.sort_order`, versionId,
  );
  const summary = rows[0];
  if (!summary) return null;
  const { releaseMode, riskProjectCount, riskAdmissionId, riskConclusion, evidenceKey } = summary;
  const projects = rows.flatMap((row) => {
    if (row.projectId === null) return [];
    const { projectId, projectName, requestId, requestStatus, usable, passed, batchId, batchCode, batchProjectId, batchStatus, batchConclusion } = row;
    return [{ projectId, projectName, requestId, requestStatus, usable, passed, batchId, batchCode, batchProjectId, batchStatus, batchConclusion }];
  });
  return { releaseMode, riskProjectCount, riskAdmissionId, riskConclusion, evidenceKey, projects };
}

export function findReadyTrialProject(eligibility: TrialReleaseEligibility | null, requestId: number) {
  return eligibility?.releaseMode ? eligibility.projects.find((row) => row.requestId === requestId) : undefined;
}

export function trialReleaseStateKey(row: Pick<TrialReleaseState, "riskProjectCount" | "riskAdmissionId" | "evidenceKey">) {
  return createHash("sha256")
    .update(JSON.stringify([row.evidenceKey, row.riskProjectCount === 0 ? null : row.riskAdmissionId]))
    .digest("hex");
}

export type RiskTrialEntryStage = "PENDING" | "IN_TEST" | "FAILED" | "BLOCKED" | "PASSED_NO_EVIDENCE";

export type RiskTrialEntry = {
  requestId: number;
  stage: RiskTrialEntryStage;
  batchId: number | null;
  registered: boolean;
};

const riskTrialEntryStageSql = `CASE
  WHEN e.requestStatus = 'PENDING' THEN 'PENDING'
  WHEN e.requestStatus = 'IN_TEST' AND e.batchStatus = 'IN_TEST' THEN 'IN_TEST'
  WHEN e.requestStatus = 'FAILED' AND e.batchStatus = 'COMPLETED' AND e.batchConclusion = 'FAIL' THEN 'FAILED'
  WHEN e.requestStatus = 'BLOCKED' AND e.batchStatus = 'COMPLETED' AND e.batchConclusion = 'BLOCKED' THEN 'BLOCKED'
  WHEN e.requestStatus = 'PASSED' AND e.passed = 0 THEN 'PASSED_NO_EVIDENCE'
END`;

export function getRiskTrialEntries(requestIds: number[]): Record<number, RiskTrialEntry | undefined> {
  if (requestIds.length === 0) return {};

  const rows = all<Omit<RiskTrialEntry, "stage" | "registered"> & { stage: RiskTrialEntryStage | null; registered: number }>(
    `WITH selected_requests AS (SELECT value AS id FROM json_each(?)),
          ${trialEligibilityCtes("AND id IN (SELECT package_version_id FROM version_transfer_requests WHERE id IN (SELECT id FROM selected_requests))")}
     SELECT e.requestId, e.batchId, ${riskTrialEntryStageSql} AS stage,
            a.id IS NOT NULL AS registered
     FROM trial_project_evidence e
     LEFT JOIN trial_risk_admissions a ON a.package_version_id = e.versionId AND a.invalidated_at IS NULL
     WHERE e.requestId IN (SELECT id FROM selected_requests)`,
    JSON.stringify(requestIds),
  );
  return Object.fromEntries(rows.flatMap(({ stage, registered, ...row }) =>
    stage ? [[row.requestId, { ...row, stage, registered: Boolean(registered) }]] : [],
  ));
}

export function getRiskTrialAdmissionEvidence(requestId: number) {
  return one<{
    stage: RiskTrialEntryStage | null;
    batchId: number | null;
    registered: number;
    riskProjectCount: number;
    unavailableRequestCount: number;
  }>(
    `WITH ${trialEligibilityCtes("AND id = (SELECT package_version_id FROM version_transfer_requests WHERE id = ?)")}
     SELECT e.batchId, ${riskTrialEntryStageSql} AS stage, q.riskAdmissionId IS NOT NULL AS registered,
            q.riskProjectCount, q.unavailableRequestCount
     FROM trial_project_evidence e
     JOIN trial_eligibility q ON q.versionId = e.versionId
     WHERE e.requestId = ?`,
    requestId, requestId,
  );
}

type TrialProgress = {
  versionId: number;
  releaseMode: "INTEGRATION" | "RISK" | null;
  missingRequestCount: number;
  inProjectScope: number;
  passedInProject: number;
};

export function getTrialProgress(versionIds: number[], projectId?: number) {
  if (versionIds.length === 0) return new Map<number, TrialProgress>();

  const rows = all<TrialProgress>(
    `WITH ${trialEligibilityCtes("AND id IN (SELECT value FROM json_each(?))")}
     SELECT q.versionId, q.releaseMode, q.missingRequestCount, e.projectId IS NOT NULL AS inProjectScope,
            COALESCE(e.passed, 0) AS passedInProject
     FROM trial_eligibility q
     LEFT JOIN trial_project_evidence e ON e.versionId = q.versionId AND e.projectId = ?`,
    JSON.stringify(versionIds), projectId ?? null,
  );
  return new Map(rows.map((row) => [row.versionId, row]));
}

export type TrialReadyVersion = LinkedBatchEvidence & {
  requestId: number;
  versionId: number;
  projectId: number;
  projectName: string;
  projectCode: string;
  packageId: number;
  packageName: string;
  packageCode: string;
  version: string;
  integrationStatus: string;
  versionStatus: string;
  changeSummary: string;
  archiveUrl: string;
  submittedByName: string | null;
  submittedAt: string;
  ownerName: string | null;
  softwareManagerName: string | null;
  softwareManagerId: number | null;
  releaseMode: "INTEGRATION" | "RISK";
  riskConclusion: string | null;
  batchTestSummary: string | null;
  batchReportUrl: string | null;
  versionProjectCount: number;
  riskProjectCount: number;
  riskAdmissionId: number | null;
  evidenceKey: string;
  ongoingTestCount: number;
};

type TrialReadyScope = { requestId?: number; versionId?: number };

const trialReadyFrom = `FROM trial_eligibility q
  JOIN trial_project_evidence e ON e.versionId = q.versionId
  JOIN version_transfer_requests r ON r.id = e.requestId
  JOIN package_versions pv ON pv.id = q.versionId
  JOIN packages p ON p.id = pv.package_id
  JOIN projects pr ON pr.id = e.projectId`;
const trialReadyCondition = "q.releaseMode IS NOT NULL";
const trialReadyProjectScope = "AND pr.id IN (SELECT value FROM json_each(?))";
// Select candidates used by the requested projects, then retain every active use as evidence.
const trialReadyProjectVersionScope = `AND package_id IN (
  SELECT package_id FROM package_usages WHERE project_id IN (SELECT value FROM json_each(?))
)`;
const trialReadyOrder = "ORDER BY pr.sort_order, pv.submitted_at DESC, r.id DESC";

function trialReadyProjectSelection(projectIds: number[] | null) {
  if (projectIds === null) return { versionScope: "", projectScope: "", params: [] };
  return {
    versionScope: trialReadyProjectVersionScope,
    projectScope: trialReadyProjectScope,
    params: [JSON.stringify(projectIds)],
  };
}

export function getProjectTrialReadyCount(projectId: number): number {
  // Limit candidate versions while keeping every active use in the eligibility check.
  const versionScope = "AND package_id IN (SELECT package_id FROM package_usages WHERE project_id = ?)";
  return one<{ total: number }>(
    `WITH ${trialEligibilityCtes(versionScope)}
     SELECT COUNT(*) AS total ${trialReadyFrom}
     WHERE ${trialReadyCondition} AND e.projectId = ?`,
    projectId, projectId,
  )?.total ?? 0;
}

export function getTrialReadyVersionCount(projectIds: number[] | null): number {
  if (projectIds?.length === 0) return 0;
  const { versionScope, projectScope, params } = trialReadyProjectSelection(projectIds);
  return one<{ total: number }>(
    `WITH ${trialEligibilityCtes(versionScope)}
     SELECT COUNT(DISTINCT q.versionId) AS total ${trialReadyFrom}
     WHERE ${trialReadyCondition} ${projectScope}`,
    ...params, ...params,
  )?.total ?? 0;
}

export function getTrialReadyVersions(
  projectIds: number[] | null = null,
  options: TrialReadyScope = {},
): TrialReadyVersion[] {
  if (projectIds?.length === 0) return [];
  const requestScope = options.requestId === undefined ? "" : "AND id = (SELECT package_version_id FROM version_transfer_requests WHERE id = ?)";
  const versionScope = options.versionId === undefined ? "" : "AND id = ?";
  const project = trialReadyProjectSelection(projectIds);
  const prefilterVersions = options.requestId === undefined && options.versionId === undefined;
  const projectVersionScope = prefilterVersions ? project.versionScope : "";
  return all<TrialReadyVersion>(
    `WITH ${trialEligibilityCtes(`${requestScope} ${versionScope} ${projectVersionScope}`)}
     SELECT r.id AS requestId, pv.id AS versionId, pr.id AS projectId, pr.name AS projectName,
            pr.code AS projectCode, p.id AS packageId, p.name AS packageName, p.code AS packageCode,
            pv.version, r.status AS integrationStatus, pv.status AS versionStatus, pv.change_summary AS changeSummary,
            pv.archive_url AS archiveUrl, su.name AS submittedByName, pv.submitted_at AS submittedAt,
            o.name AS ownerName, sm.name AS softwareManagerName, pr.software_manager_id AS softwareManagerId,
            q.releaseMode,
            q.riskConclusion, q.riskAdmissionId, q.evidenceKey, q.versionProjectCount, q.riskProjectCount,
            e.batchId, e.batchCode, e.batchProjectId, e.batchStatus, e.batchConclusion,
            b.test_summary AS batchTestSummary, b.test_report_url AS batchReportUrl,
            ${ACTIVE_INTEGRATION_BATCH_COUNT_SQL} AS ongoingTestCount
     ${trialReadyFrom}
     LEFT JOIN users su ON su.id = pv.submitted_by
     LEFT JOIN users o ON o.id = p.owner_id
     LEFT JOIN users sm ON sm.id = pr.software_manager_id
     LEFT JOIN integration_batches b ON b.id = e.batchId
     WHERE ${trialReadyCondition}
       ${options.requestId === undefined ? "" : "AND r.id = ?"} ${project.projectScope}
     ${trialReadyOrder}`,
    ...(options.requestId === undefined ? [] : [options.requestId]),
    ...(options.versionId === undefined ? [] : [options.versionId]),
    ...(prefilterVersions ? project.params : []),
    ...(options.requestId === undefined ? [] : [options.requestId]),
    ...project.params,
  );
}

export function getWorkbenchTrialReadyRows(projectIds: number[] | null) {
  if (projectIds?.length === 0) return [];
  const projects = projectIds === null ? null : JSON.stringify(projectIds);
  const versionScope = projects === null ? "" : trialReadyProjectVersionScope;
  return all<Pick<TrialReadyVersion, "versionId" | "projectName" | "packageName" | "packageCode" | "version" | "riskProjectCount">>(
    `WITH ${trialEligibilityCtes(versionScope)}
     SELECT pv.id AS versionId, pr.name AS projectName, p.name AS packageName, p.code AS packageCode,
            pv.version, q.riskProjectCount
     ${trialReadyFrom}
     WHERE ${trialReadyCondition} ${projects === null ? "" : trialReadyProjectScope}
     ${trialReadyOrder}`,
    ...(projects === null ? [] : [projects, projects]),
  );
}

export type TrialReadyDisplayVersion = Omit<TrialReadyVersion, keyof LinkedBatchEvidence | "batchTestSummary" | "batchReportUrl"> & {
  hasLinkedBatch: boolean;
  batch: (NonNullable<ReturnType<typeof getReadableLinkedBatchEvidence>> & {
    testSummary: string | null;
    reportUrl: string | null;
  }) | null;
};

export function getTrialReadyDisplayVersions(
  user: SessionUser,
  projectIds: number[] | null,
  options: TrialReadyScope = {},
): TrialReadyDisplayVersion[] {
  const rows = getTrialReadyVersions(projectIds, options);
  if (rows.length === 0) return [];
  const scope = getBatchEvidenceReadScope(user);
  return rows.map(({ batchId, batchProjectId, batchStatus, batchCode, batchConclusion, batchTestSummary, batchReportUrl, ...row }) => {
    const batch = getReadableLinkedBatchEvidence(user, { batchId, batchProjectId, batchStatus, batchCode, batchConclusion }, scope);
    return {
      ...row,
      hasLinkedBatch: batchId !== null,
      batch: batch ? { ...batch, testSummary: batchTestSummary, reportUrl: batchReportUrl } : null,
    };
  });
}

export function getTrialNodeUsages(packageId: number) {
  return all<{
    projectId: number;
    projectName: string;
    nodeId: number;
    nodeName: string;
    requiredCount: number;
    bindingOwnerId: number | null;
    bindingApproverId: number | null;
  }>(`SELECT u.project_id AS projectId, p.name AS projectName, u.node_id AS nodeId,
            n.name AS nodeName, n.required_binding_count AS requiredCount,
            n.binding_owner_id AS bindingOwnerId, n.binding_approver_id AS bindingApproverId
     FROM package_usages u
     JOIN project_nodes n ON n.id = u.node_id
     JOIN projects p ON p.id = u.project_id
     WHERE u.package_id = ? AND p.status != 'ARCHIVED'
     ORDER BY p.sort_order, n.sort_order`, packageId);
}

export function missingTrialNodeAssignments(node: { bindingOwnerId: number | null; bindingApproverId: number | null }) {
  return [
    ...(!node.bindingOwnerId ? ["绑定验证责任人"] : []),
    ...(!node.bindingApproverId ? ["绑定电子流审批人"] : []),
  ];
}
