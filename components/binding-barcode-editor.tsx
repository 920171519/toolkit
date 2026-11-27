"use client";

import { useState, type ReactNode } from "react";
import { ActionForm } from "@/components/action-form";
import { saveBindingBarcodeResultsAction } from "@/lib/actions/workflow";
import type { BindingBarcodeRow } from "@/lib/binding-queries";
import styles from "./binding-barcode-list.module.css";

export function BindingBarcodeEditor({ barcodes, hidden, children }: {
  barcodes: readonly Pick<BindingBarcodeRow, "id" | "result">[];
  hidden: Record<string, string | number | undefined | null>;
  children: ReactNode;
}) {
  const [changed, setChanged] = useState(false);
  return (
    <ActionForm action={saveBindingBarcodeResultsAction} hidden={hidden} className={styles.flowEditor}
      submitText="保存条码判定" submitClassName="button-sm" submitVariant="secondary" disabled={!changed}
      footerNote={changed ? "有未保存的判定" : undefined}
      onChange={(event) => {
        const values = new FormData(event.currentTarget);
        setChanged(barcodes.some(({ id, result }) => values.get(`result_${id}`) !== result));
      }}>
      {children}
    </ActionForm>
  );
}
