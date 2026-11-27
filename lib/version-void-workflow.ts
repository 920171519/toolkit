import "server-only";

import { db, run } from "./db";
import { invalidateTrialRiskAdmissionForVersion } from "./trial-risk-admissions";
import type { SessionUser } from "./types";
import type { ManualVersionVoidKind } from "./version-void";

type VersionVoidKind = "RISK_TEST_FAILURE" | ManualVersionVoidKind;

// The caller owns authorization and the surrounding write transaction.
export function voidVersionRecords(actor: SessionUser, versionId: number, kind: VersionVoidKind, reason: string, timestamp: string) {
  run(
    `UPDATE package_versions SET status = 'VOID', void_kind = ?, void_reason = ?,
       voided_at = ?, voided_by = ?, updated_at = ? WHERE id = ?`,
    kind, reason, timestamp, actor.id, timestamp, versionId,
  );
  run(
    `UPDATE version_transfer_requests SET status = 'VOID', void_reason = ?, voided_at = ?, updated_at = ?
     WHERE package_version_id = ?`,
    reason, timestamp, timestamp, versionId,
  );
  invalidateTrialRiskAdmissionForVersion(db, versionId, timestamp);
  run(
    `UPDATE binding_requirements SET status = 'CANCELLED', decision_reason = ?, updated_at = ?
     WHERE package_version_id = ? AND status IN ('PENDING','PASSED')`,
    reason, timestamp, versionId,
  );
}
