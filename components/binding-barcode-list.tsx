import { Badge } from "@/components/ui";
import { BINDING_BARCODE_RESULTS, type BindingBarcodeResult } from "@/lib/binding-barcode-results";
import { formatDateTime } from "@/lib/format";
import type { BindingBarcodeRow } from "@/lib/binding-queries";
import styles from "./binding-barcode-list.module.css";

const outcomes = {
  UNREVIEWED: { label: "未判定", tone: "slate" },
  PASS: { label: "PASS", tone: "emerald" },
  FAIL: { label: "FAIL", tone: "rose" },
} as const satisfies Record<BindingBarcodeResult, { label: string; tone: string }>;

export function BindingBarcodeList({ barcodes, editable = false }: {
  barcodes: readonly BindingBarcodeRow[];
  editable?: boolean;
}) {
  return (
    <ul className={styles.barcodeList} aria-label="设备条码验证结果">
      {barcodes.map(({ id, barcode, result, failureReason, validatedByName, validatedAt, failureReasonByName, failureReasonAt }) => (
        <li key={id} className={styles.barcodeRow}>
          <div className={styles.identity}>
            <span className={`mono barcode-chip ${styles.code}`}>{barcode}</span>
            {result === "FAIL" && failureReason && <p className={styles.reason}>{failureReason}</p>}
            {validatedAt && <p className={styles.audit}>{[validatedByName, formatDateTime(validatedAt)].filter(Boolean).join(" · ")}</p>}
            {result === "FAIL" && failureReasonAt && <p className={styles.audit}>原因记录 {failureReasonByName ?? "—"} · {formatDateTime(failureReasonAt)}</p>}
          </div>
          {editable ? (
            <select className={`select select-sm ${styles.resultSelect}`} name={`result_${id}`} aria-label={`条码 ${barcode} 验证结果`} defaultValue={result}>
              {BINDING_BARCODE_RESULTS.map((value) => <option key={value} value={value}>{outcomes[value].label}</option>)}
            </select>
          ) : <Badge tone={outcomes[result].tone}>{outcomes[result].label}</Badge>}
        </li>
      ))}
    </ul>
  );
}
