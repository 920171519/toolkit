import { all } from "./db";
import { TRIAL_PENDING_VERSION_STATUSES_SQL } from "./transfer-requests";

const trialRequestStatuses = "('PENDING','IN_TEST','PASSED','FAILED','BLOCKED')";

export function trialEligibilityCtes(versionsSql: string) {
  return `
    trial_versions AS (${versionsSql}),
    trial_scope AS (
      SELECT DISTINCT v.id AS versionId, u.project_id AS projectId
      FROM trial_versions v
      JOIN package_usages u ON u.package_id = v.package_id
      JOIN projects p ON p.id = u.project_id AND p.status != 'ARCHIVED'
    ),
    trial_project_evidence AS (
      SELECT s.versionId, s.projectId, r.id AS requestId, r.status AS requestStatus, b.id AS batchId,
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
    `WITH ${trialEligibilityCtes(`SELECT id, package_id FROM package_versions
       WHERE status IN ${TRIAL_PENDING_VERSION_STATUSES_SQL} AND id IN (SELECT value FROM json_each(?))`)}
     SELECT q.versionId, q.releaseMode, q.missingRequestCount, e.projectId IS NOT NULL AS inProjectScope,
            COALESCE(e.passed, 0) AS passedInProject
     FROM trial_eligibility q
     LEFT JOIN trial_project_evidence e ON e.versionId = q.versionId AND e.projectId = ?`,
    JSON.stringify(versionIds), projectId ?? null,
  );
  return new Map(rows.map((row) => [row.versionId, row]));
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
