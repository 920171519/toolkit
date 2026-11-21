import { all } from "./db";

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
    `SELECT r.id AS requestId, b.id AS batchId,
            CASE
              WHEN r.status = 'PENDING' THEN 'PENDING'
              WHEN r.status = 'IN_TEST' AND b.status = 'IN_TEST' THEN 'IN_TEST'
              WHEN r.status = 'FAILED' AND b.status = 'COMPLETED' AND b.conclusion = 'FAIL' THEN 'FAILED'
              WHEN r.status = 'BLOCKED' AND b.status = 'COMPLETED' AND b.conclusion = 'BLOCKED' THEN 'BLOCKED'
              WHEN r.status = 'PASSED' THEN
                CASE WHEN b.status = 'COMPLETED' AND b.conclusion = 'PASS' THEN NULL ELSE 'PASSED_NO_EVIDENCE' END
            END AS stage,
            a.id IS NOT NULL AS registered
     FROM version_transfer_requests r
     JOIN package_versions pv ON pv.id = r.package_version_id
     JOIN projects p ON p.id = r.project_id
     LEFT JOIN integration_batches b ON b.id = (
       SELECT bi.batch_id FROM batch_items bi WHERE bi.transfer_request_id = r.id ORDER BY bi.id DESC LIMIT 1
     )
     LEFT JOIN trial_risk_admissions a ON a.package_version_id = pv.id AND a.invalidated_at IS NULL
     WHERE r.id IN (SELECT value FROM json_each(?))
       AND pv.status IN ('PENDING_TRANSFER','IN_TEST','PENDING_TRIAL')
       AND p.status != 'ARCHIVED'
       AND EXISTS (SELECT 1 FROM package_usages u WHERE u.package_id = pv.package_id AND u.project_id = r.project_id)`,
    JSON.stringify(requestIds),
  );
  return Object.fromEntries(rows.flatMap(({ stage, registered, ...row }) =>
    stage ? [[row.requestId, { ...row, stage, registered: Boolean(registered) }]] : [],
  ));
}
