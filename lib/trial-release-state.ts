export function trialReleaseStateKey(row: { riskProjectCount: number; riskAdmissionId: number | null }) {
  return row.riskProjectCount === 0 ? "integration" : "risk:" + row.riskAdmissionId;
}
