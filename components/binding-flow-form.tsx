import { submitBindingFlowAction } from "@/lib/actions/workflow";
import { ActionForm } from "@/components/action-form";

type ApproverOption = { userId: number; userName: string; userEmployeeId: string };

export function BindingFlowForm({
  requirementId,
  requestId,
  approvers,
  currentUserId,
  scopeProjectId,
  listState,
}: {
  requirementId: number;
  requestId: number;
  approvers: ApproverOption[];
  currentUserId: number;
  scopeProjectId?: number;
  listState?: Record<string, string | number | undefined>;
}) {
  const selectableApprovers = approvers.filter((approver) => approver.userId !== currentUserId);
  const barcodeId = `binding-barcodes-${requirementId}`;
  if (selectableApprovers.length === 0) {
    return <div className="muted-panel">该节点审批人范围为空，请联系软件经理在项目配置中维护审批人。</div>;
  }

  return (
    <ActionForm
      action={submitBindingFlowAction}
      hidden={{ requirementId, requestId, scopeProjectId, ...listState }}
      submitText="提交绑定电子流"
      submitClassName="button-sm"
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
        <div className="field">
          <div className="label">
            <label htmlFor={barcodeId}>设备条码 <span className="required-mark" aria-hidden="true">*</span></label>
            <span className="hint" id={`${barcodeId}-format`}>每行一个</span>
          </div>
          <textarea className="textarea barcode-textarea" id={barcodeId} name="barcodes" rows={4} required aria-describedby={`${barcodeId}-format`} />
        </div>
        <label className="field">
          <span className="label">网页电子流地址 <span className="required-mark" aria-hidden="true">*</span></span>
          <input className="input" name="webUrl" type="url" required />
        </label>
      </div>
    </ActionForm>
  );
}
