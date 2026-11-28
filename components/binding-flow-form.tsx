import Link from "next/link";
import { submitBindingFlowAction } from "@/lib/actions/binding";
import { ActionForm } from "@/components/action-form";

type ApproverOption = { userId: number; userName: string; userEmployeeId: string; isActive: number };

export function BindingFlowForm({
  requirementId,
  requestId,
  approvers,
  currentUserId,
  scopeProjectId,
  listState,
  configurationHref,
}: {
  requirementId: number;
  requestId: number;
  approvers: ApproverOption[];
  currentUserId: number;
  scopeProjectId?: number;
  listState?: Record<string, string | number | undefined>;
  configurationHref?: string;
}) {
  const possibleApprovers = approvers.filter((approver) => approver.userId !== currentUserId);
  const selectableApprovers = possibleApprovers.filter((approver) => approver.isActive);
  const barcodeId = `binding-barcodes-${requirementId}`;
  if (selectableApprovers.length === 0) {
    return <div className="muted-panel">
      <p>{approvers.length === 0 ? "该节点尚未配置审批人。" : possibleApprovers.length === 0
        ? "审批范围内只有当前提交人。电子流须由其他人审批。"
        : "其他候选审批人已停用。"}</p>
      {configurationHref ? <Link className="archive-link" href={configurationHref} prefetch={false}>配置节点审批人</Link>
        : <p>请联系该项目的软件经理调整审批范围。</p>}
    </div>;
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
