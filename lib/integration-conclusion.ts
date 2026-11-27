import { ATTRIBUTION_META, CONCLUSION_META, type BatchConclusion, type IssueAttribution } from "./constants";

type AttributionRule = {
  choices: readonly [IssueAttribution, ...IssueAttribution[]];
  errorMessage: string;
};

export const integrationAttributionRules: Readonly<Record<BatchConclusion, AttributionRule>> = {
  PASS: {
    choices: ["NONE"],
    errorMessage: `测试通过时问题归属应为“${ATTRIBUTION_META.NONE.label}”。`,
  },
  FAIL: {
    choices: ["PACKAGE_RELATED", "NOT_PACKAGE_RELATED"],
    errorMessage: "测试不通过时需要判断问题是否与软件包相关。",
  },
  BLOCKED: {
    choices: ["UNKNOWN"],
    errorMessage: `无法完成验证时问题归属应为“${ATTRIBUTION_META.UNKNOWN.label}”。`,
  },
};

export function isBatchConclusion(value: string): value is BatchConclusion {
  return Object.hasOwn(CONCLUSION_META, value);
}

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
