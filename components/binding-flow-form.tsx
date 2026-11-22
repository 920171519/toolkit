import { submitBindingFlowAction } from "@/lib/actions/workflow";
import { ActionForm } from "@/components/action-form";

type ApproverOption = { userId: number; userName: string; userEmployeeId: string };

export function BindingFlowForm({
  requirementId,
  requestId,
  approvers,
  currentUserId,
  scopeProjectId,
  trialQuery,
}: {
  requirementId: number;
  requestId: number;
  approvers: ApproverOption[];
  currentUserId: number;
  scopeProjectId?: number;
  trialQuery: Record<string, string>;
}) {
  const selectableApprovers = approvers.filter((approver) => approver.userId !== currentUserId);
  if (selectableApprovers.length === 0) {
    return <div className="muted-panel">该节点审批人范围为空，请联系软件经理在项目配置中维护审批人。</div>;
  }

  return (
    <ActionForm
      action={submitBindingFlowAction}
      hidden={{ ...trialQuery, requirementId, requestId, scopeProjectId }}
      submitText="提交绑定电子流"
      submitClassName="button-sm"
      footerNote="设备条码每行一个，支持扫码枪连续录入或一次粘贴多个条码。"
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
        <label className="field">
          <span className="label">设备条码 <span className="required-mark">*</span><span className="hint">每行一个</span></span>
          <textarea className="textarea barcode-textarea" name="barcodes" rows={4} required placeholder="每行一个设备条码，例如 SN0001" />
        </label>
        <label className="field">
          <span className="label">网页电子流地址 <span className="required-mark">*</span><span className="hint">审批人可打开核验</span></span>
          <input className="input" name="webUrl" type="url" required placeholder="https://eflow.example.com/binding/..." />
        </label>
      </div>
    </ActionForm>
  );
}
