import { createHash } from "node:crypto";

export function trialReleaseStateKey(row: { riskProjectCount: number; riskAdmissionId: number | null; evidenceKey: string }) {
  return createHash("sha256")
    .update(JSON.stringify([row.evidenceKey, row.riskProjectCount === 0 ? null : row.riskAdmissionId]))
    .digest("hex");
}
