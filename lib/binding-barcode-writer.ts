import type { DatabaseSync } from "node:sqlite";

export function prepareBindingBarcodeWriter(database: DatabaseSync) {
  const insert = database.prepare("INSERT INTO binding_flow_barcodes (flow_id, barcode, created_at) VALUES (?, ?, ?)");
  return function writeBindingBarcodes(flowId: number, barcodes: Iterable<string>, createdAt: string) {
    for (const barcode of barcodes) insert.run(flowId, barcode, createdAt);
  };
}
