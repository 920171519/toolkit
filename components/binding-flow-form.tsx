"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { submitBindingFlowAction } from "@/lib/actions/workflow";
import { ActionForm } from "@/components/action-form";

type ApproverOption = { userId: number; userName: string; userEmployeeId: string };

export function BindingFlowForm({
  requirementId,
  requestId,
  approvers,
  currentUserId,
}: {
  requirementId: number;
  requestId: number;
  approvers: ApproverOption[];
  currentUserId: number;
}) {
  const selectableApprovers = approvers.filter((approver) => approver.userId !== currentUserId);
  const [barcodes, setBarcodes] = useState<string[]>([""]);
  const normalized = barcodes.map((barcode) => barcode.trim()).filter(Boolean);

  if (selectableApprovers.length === 0) {
    return <div className="muted-panel">该节点审批人范围为空，请联系软件经理在项目配置中维护审批人。</div>;
  }

  return (
    <ActionForm
      action={submitBindingFlowAction}
      hidden={{ requirementId, requestId }}
      submitText="提交绑定电子流"
      submitClassName="button-sm"
      disabled={normalized.length === 0}
      footerNote="一个电子流可绑定多个设备条码；可多次提交。"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <label className="field">
          <span className="label">电子流审批人 <span className="required-mark">*</span></span>
          <select className="select" name="approverId" required defaultValue={selectableApprovers[0].userId}>
            {selectableApprovers.map((approver) => (
              <option value={approver.userId} key={approver.userId}>
                {approver.userName}{approver.userEmployeeId ? ` · ${approver.userEmployeeId}` : ""}
              </option>
            ))}
          </select>
        </label>
        {barcodes.map((barcode, index) => (
          <div className="barcode-input-row" key={index}>
            <label className="field" style={{ flex: 1 }}>
              <span className="label">设备条码 {index + 1} <span className="required-mark">*</span></span>
              <input
                className="input"
                name="barcodes"
                value={barcode}
                placeholder="输入或扫描设备条码"
                onChange={(event) => {
                  const value = event.target.value;
                  setBarcodes((current) => current.map((item, itemIndex) => itemIndex === index ? value : item));
                }}
              />
            </label>
            {barcodes.length > 1 && (
              <button type="button" className="button button-ghost button-sm" title="移除条码" aria-label="移除条码" onClick={() => setBarcodes((current) => current.filter((_, itemIndex) => itemIndex !== index))} style={{ marginTop: 20 }}>
                <Trash2 size={13} />
              </button>
            )}
          </div>
        ))}
        <button type="button" className="button button-secondary button-sm" onClick={() => setBarcodes((current) => [...current, ""])} style={{ alignSelf: "flex-start" }}>
          <Plus size={13} /> 添加条码
        </button>
      </div>
    </ActionForm>
  );
}
