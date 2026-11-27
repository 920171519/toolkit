import { createHash } from "node:crypto";
import { all } from "./db";
import { TRIAL_PENDING_VERSION_STATUSES_SQL } from "./transfer-requests";
import { ACTIVE_INTEGRATION_BATCH_COUNT_SQL } from "./trial-readiness";

const trialRequestStatuses = "('PENDING','IN_TEST','PASSED','FAILED','BLOCKED')";

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
             b.id AS batchId, b.code AS batchCode, b.status AS batchStatus, b.conclusion AS batchConclusion,
             r.status IN ${trialRequestStatuses} AS usable,
             CASE WHEN r.status = 'PASSED' AND b.status = 'COMPLETED' AND b.conclusion = 'PASS' THEN 1 ELSE 0 END AS passed
      FROM trial_scope s
      LEFT JOIN version_transfer_requests r ON r.package_version_id = s.versionId AND r.project_id = s.projectId
      LEFT JOIN integration_batches b ON b.id = (
        SELECT bi.batch_id FROM batch_items bi WHERE bi.transfer_request_id = r.id ORDER BY bi.id DESC LIMIT 1
      )
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

type TrialProjectEvidence = {
  projectId: number;
  projectName: string;
  requestId: number | null;
  requestStatus: string | null;
  usable: number | null;
  passed: number;
  batchId: number | null;
  batchCode: string | null;
  batchStatus: string | null;
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
            e.batchId, e.batchCode, e.batchStatus
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
    const { projectId, projectName, requestId, requestStatus, usable, passed, batchId, batchCode, batchStatus } = row;
    return [{ projectId, projectName, requestId, requestStatus, usable, passed, batchId, batchCode, batchStatus }];
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

export function getRiskTrialEntries(requestIds: number[]): Record<number, RiskTrialEntry | undefined> {
  if (requestIds.length === 0) return {};

  const rows = all<Omit<RiskTrialEntry, "stage" | "registered"> & { stage: RiskTrialEntryStage | null; registered: number }>(
    `WITH selected_requests AS (SELECT value AS id FROM json_each(?)),
          ${trialEligibilityCtes("AND id IN (SELECT package_version_id FROM version_transfer_requests WHERE id IN (SELECT id FROM selected_requests))")}
     SELECT e.requestId, e.batchId,
            CASE
              WHEN e.requestStatus = 'PENDING' THEN 'PENDING'
              WHEN e.requestStatus = 'IN_TEST' AND e.batchStatus = 'IN_TEST' THEN 'IN_TEST'
              WHEN e.requestStatus = 'FAILED' AND e.batchStatus = 'COMPLETED' AND e.batchConclusion = 'FAIL' THEN 'FAILED'
              WHEN e.requestStatus = 'BLOCKED' AND e.batchStatus = 'COMPLETED' AND e.batchConclusion = 'BLOCKED' THEN 'BLOCKED'
              WHEN e.requestStatus = 'PASSED' AND e.passed = 0 THEN 'PASSED_NO_EVIDENCE'
            END AS stage,
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

export type TrialReadyVersion = {
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
  batchId: number | null;
  batchCode: string | null;
  batchConclusion: string | null;
  batchTestSummary: string | null;
  batchReportUrl: string | null;
  versionProjectCount: number;
  riskProjectCount: number;
  riskAdmissionId: number | null;
  evidenceKey: string;
  ongoingTestCount: number;
};

export function getTrialReadyVersions(
  projectIds: number[] | null = null,
  options: { requestId?: number; versionId?: number } = {},
): TrialReadyVersion[] {
  if (projectIds?.length === 0) return [];
  const requestScope = options.requestId === undefined ? "" : "AND id = (SELECT package_version_id FROM version_transfer_requests WHERE id = ?)";
  const versionScope = options.versionId === undefined ? "" : "AND id = ?";
  const projectsScope = projectIds === null ? "" : "AND pr.id IN (SELECT value FROM json_each(?))";
  return all<TrialReadyVersion>(
    `WITH ${trialEligibilityCtes(`${requestScope} ${versionScope}`)}
     SELECT r.id AS requestId, pv.id AS versionId, pr.id AS projectId, pr.name AS projectName,
            pr.code AS projectCode, p.id AS packageId, p.name AS packageName, p.code AS packageCode,
            pv.version, r.status AS integrationStatus, pv.status AS versionStatus, pv.change_summary AS changeSummary,
            pv.archive_url AS archiveUrl, su.name AS submittedByName, pv.submitted_at AS submittedAt,
            o.name AS ownerName, sm.name AS softwareManagerName, pr.software_manager_id AS softwareManagerId,
            q.releaseMode,
            q.riskConclusion, q.riskAdmissionId, q.evidenceKey, q.versionProjectCount, q.riskProjectCount,
            e.batchId, e.batchCode, e.batchConclusion,
            b.test_summary AS batchTestSummary, b.test_report_url AS batchReportUrl,
            ${ACTIVE_INTEGRATION_BATCH_COUNT_SQL} AS ongoingTestCount
     FROM trial_eligibility q
     JOIN trial_project_evidence e ON e.versionId = q.versionId
     JOIN version_transfer_requests r ON r.id = e.requestId
     JOIN package_versions pv ON pv.id = q.versionId
     JOIN packages p ON p.id = pv.package_id
     JOIN projects pr ON pr.id = e.projectId
     LEFT JOIN users su ON su.id = pv.submitted_by
     LEFT JOIN users o ON o.id = p.owner_id
     LEFT JOIN users sm ON sm.id = pr.software_manager_id
     LEFT JOIN integration_batches b ON b.id = e.batchId
     WHERE q.releaseMode IS NOT NULL
       ${options.requestId === undefined ? "" : "AND r.id = ?"} ${projectsScope}
     ORDER BY pr.sort_order, pv.submitted_at DESC, r.id DESC`,
    ...(options.requestId === undefined ? [] : [options.requestId]),
    ...(options.versionId === undefined ? [] : [options.versionId]),
    ...(options.requestId === undefined ? [] : [options.requestId]),
    ...(projectIds === null ? [] : [JSON.stringify(projectIds)]),
  );
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
