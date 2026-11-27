// Both batch queries use bi for the batch item and pv for its current version.
export const PARALLEL_RISK_TRIAL_ITEM_SQL = `bi.transfer_request_id IS NOT NULL AND pv.release_mode = 'RISK'
  AND pv.status IN ('TRIAL','PENDING_FORMAL')`;

export function integrationConclusionImpact(
  conclusion: string,
  attribution: string,
  items: readonly { parallelRiskTrial: boolean | number | null }[],
) {
  const acceptsAffectedVersions = conclusion === "FAIL" && attribution === "PACKAGE_RELATED";
  return {
    acceptsAffectedVersions,
    requiresAffectedVersions: acceptsAffectedVersions && items.some((item) => Boolean(item.parallelRiskTrial)),
  };
}
