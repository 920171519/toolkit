import "server-only";

import type { DatabaseSync } from "node:sqlite";
import { TRIAL_PENDING_VERSION_STATUSES_SQL } from "./transfer-requests";
import type { RiskTrialEntryStage } from "./trial-eligibility";

type TrialRiskAdmissionInput = {
  versionId: number;
  requestId: number;
  projectId: number;
  projectName: string;
  batchId: number | null;
  stage: RiskTrialEntryStage;
  reason: string;
  actorId: number;
  createdAt: string;
};

const currentAdmissionForVersion = "package_version_id = ? AND invalidated_at IS NULL";

// The caller owns authorization and the surrounding transaction.
export function insertTrialRiskAdmission(database: DatabaseSync, admission: TrialRiskAdmissionInput) {
  database.prepare(
    `INSERT INTO trial_risk_admissions
       (package_version_id, request_id, project_id, project_name, batch_id, stage, reason, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(admission.versionId, admission.requestId, admission.projectId, admission.projectName, admission.batchId, admission.stage,
    admission.reason, admission.actorId, admission.createdAt);
}

export function invalidateTrialRiskAdmissionForVersion(database: DatabaseSync, versionId: number, timestamp: string) {
  database.prepare(
    `UPDATE trial_risk_admissions SET invalidated_at = ? WHERE ${currentAdmissionForVersion}`,
  ).run(timestamp, versionId);
}

export function invalidateInTestRiskAdmissionsForBatch(database: DatabaseSync, batchId: number, timestamp: string) {
  database.prepare(
    "UPDATE trial_risk_admissions SET invalidated_at = ? WHERE batch_id = ? AND stage = 'IN_TEST' AND invalidated_at IS NULL",
  ).run(timestamp, batchId);
}

export function invalidateUnreleasedRiskTrialAdmission(database: DatabaseSync, versionId: number, timestamp: string) {
  database.prepare(
    `UPDATE trial_risk_admissions SET invalidated_at = ?
     WHERE ${currentAdmissionForVersion}
       AND EXISTS (SELECT 1 FROM package_versions pv WHERE pv.id = package_version_id
         AND pv.status IN ${TRIAL_PENDING_VERSION_STATUSES_SQL})`,
  ).run(timestamp, versionId);
}
