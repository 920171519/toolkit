export const BINDING_BARCODE_RESULTS = ["UNREVIEWED", "PASS", "FAIL"] as const;
export type BindingBarcodeResult = (typeof BINDING_BARCODE_RESULTS)[number];
export type BindingBarcodeFact = { barcode: string; result: BindingBarcodeResult; flowStatus: string };

export const BINDING_BARCODE_FAILURE_REASON_LIMIT = 2000;

const activeBindingFlowStatuses: readonly string[] = ["PENDING", "APPROVED"];

export const ACTIVE_BINDING_FLOW_STATUSES_SQL = `(${activeBindingFlowStatuses.map((status) => `'${status}'`).join(",")})`;

export function isActiveBindingFlow(status: string): boolean {
  return activeBindingFlowStatuses.includes(status);
}

export function isBindingBarcodeResult(value: string): value is BindingBarcodeResult {
  return BINDING_BARCODE_RESULTS.some((result) => result === value);
}

export function parseBindingBarcodeText(value: string): string[] {
  return value.split(/[\n,，;；]+/).map((barcode) => barcode.trim()).filter(Boolean);
}

export function bindingBarcodeEvidenceKey(revision: number, flows: readonly { id: number; status: string }[]): string {
  const activeFlows = flows.filter((flow) => isActiveBindingFlow(flow.status))
    .sort((a, b) => a.id - b.id)
    .map(({ id, status }) => `${id}:${status}`);
  return `${revision}|${activeFlows.join(",")}`;
}

export function summarizeBindingBarcodes(facts: readonly BindingBarcodeFact[]) {
  const submitted = new Set<string>();
  const approved = new Set<string>();
  const passed = new Set<string>();
  let unreviewedApprovedCount = 0;
  let failedBarcodeCount = 0;

  for (const { barcode, result, flowStatus } of facts) {
    if (!isActiveBindingFlow(flowStatus)) continue;
    submitted.add(barcode);
    if (result === "FAIL") failedBarcodeCount += 1;
    if (flowStatus !== "APPROVED") continue;
    approved.add(barcode);
    if (result === "PASS") passed.add(barcode);
    if (result === "UNREVIEWED") unreviewedApprovedCount += 1;
  }

  return {
    submittedCount: submitted.size,
    approvedCount: approved.size,
    passedBarcodeCount: passed.size,
    unreviewedApprovedCount,
    failedBarcodeCount,
  };
}

export function bindingBarcodeProgress(requiredCount: number, counts: ReturnType<typeof summarizeBindingBarcodes>) {
  const minimum = Math.max(1, requiredCount);
  const passShortfall = Math.max(0, minimum - counts.passedBarcodeCount);
  const submissionShortfall = Math.max(0, minimum - counts.submittedCount + counts.failedBarcodeCount);
  // A confirmable count can still require a reason for each failed row and an authorized actor.
  return { passShortfall, submissionShortfall, canConfirm: passShortfall === 0 && counts.unreviewedApprovedCount === 0 };
}
