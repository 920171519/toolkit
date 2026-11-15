"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { submitBindingFlowAction } from "@/lib/actions/workflow";
import { ActionForm } from "@/components/action-form";

export function BindingFlowForm({
  requirementId,
  requestId,
}: {
  requirementId: number;
  requestId: number;
}) {
  const [barcodes, setBarcodes] = useState<string[]>([""]);
  const normalized = barcodes.map((barcode) => barcode.trim()).filter(Boolean);

  return (
    <ActionForm
      action={submitBindingFlowAction}
      hidden={{
        requirementId,
        requestId,
        barcodes: JSON.stringify(normalized),
      }}
      submitText="提交绑定电子流"
      submitClassName="button-sm"
      disabled={normalized.length === 0}
      footerNote="一个电子流可绑定多个设备条码；可多次提交。"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {barcodes.map((barcode, index) => (
          <div className="barcode-input-row" key={index}>
            <label className="field" style={{ flex: 1 }}>
              <span className="label">
                设备条码 {index + 1} <span className="required-mark">*</span>
              </span>
              <input
                className="input"
                value={barcode}
                required
                minLength={3}
                placeholder="输入或扫描设备条码"
                onChange={(event) => {
                  const value = event.target.value;
                  setBarcodes((current) => current.map((item, itemIndex) => itemIndex === index ? value : item));
                }}
              />
            </label>
            {barcodes.length > 1 && (
              <button
                type="button"
                className="button button-ghost button-sm"
                title="移除条码"
                aria-label="移除条码"
                onClick={() => setBarcodes((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                style={{ marginTop: 20 }}
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          className="button button-secondary button-sm"
          onClick={() => setBarcodes((current) => [...current, ""])}
          style={{ alignSelf: "flex-start" }}
        >
          <Plus size={13} /> 添加条码
        </button>
      </div>
    </ActionForm>
  );
}
