export type BindingBarcodeResult = "UNREVIEWED" | "PASS" | "FAIL";

export const BINDING_BARCODE_FAILURE_REASON_LIMIT = 2000;

export function isBindingBarcodeResult(value: string): value is BindingBarcodeResult {
  return value === "UNREVIEWED" || value === "PASS" || value === "FAIL";
}

export function bindingBarcodeEvidenceKey(revision: number, flows: readonly { id: number; status: string }[]): string {
  const activeFlows = flows.filter((flow) => flow.status === "PENDING" || flow.status === "APPROVED")
    .sort((a, b) => a.id - b.id)
    .map(({ id, status }) => `${id}:${status}`);
  return `${revision}|${activeFlows.join(",")}`;
}
