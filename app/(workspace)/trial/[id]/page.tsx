import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, CheckCircle2, Link2, ShieldAlert } from "lucide-react";
import { requireUser } from "@/lib/auth";
import {
  canApproveBindingFlow,
  canManageProjectWorkflow,
  canSubmitBindingFlow,
} from "@/lib/permissions";
import { parseFlash } from "@/lib/queries";
import { getTrialDetail } from "@/lib/workflow-queries";
import { formatDateTime } from "@/lib/format";
import { BINDING_FLOW_STATUS_META, type BindingFlowStatus } from "@/lib/constants";
import {
  cancelBindingFlowAction,
  decideBindingFlowAction,
  voidTrialAction,
} from "@/lib/actions/workflow";
import { ActionForm } from "@/components/action-form";
import { BindingFlowForm } from "@/components/binding-flow-form";
import { Badge, ExternalLink, FlashMessage, PageHeader, ProgressBar, StatusPill } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "绑定验证详情" };

export default async function TrialDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const requestId = Number(id);
  if (!Number.isInteger(requestId)) notFound();
  const data = getTrialDetail(requestId);
  if (!data) notFound();
  const search = await searchParams;
  const notice = parseFlash(search.flash, search.tone === "error" ? "error" : "success");
  const { request, requirements } = data;
  const manager = canManageProjectWorkflow(user, request.softwareManagerId);
  const passed = requirements.filter((requirement) => requirement.status === "PASSED").length;

  return (
    <>
      <PageHeader
        eyebrow="Trial / Project binding"
        title={`${request.projectName} · ${request.packageName} ${request.version}`}
        description={<>项目试制电子流 {request.trialFormNo ?? "—"} · 发布 {formatDateTime(request.trialReleasedAt)} · 项目软件经理 {request.softwareManagerName ?? "—"}</>}
        actions={<><Link href="/trial" className="button button-secondary"><ArrowLeft size={14} />返回试制队列</Link><StatusPill status={request.status as "TRIAL" | "PENDING_FORMAL" | "VOID" | "FORMAL"} /></>}
      />
      <FlashMessage notice={notice} />

      {request.status === "VOID" && (
        <div className="workflow-banner" data-tone="danger" style={{ marginBottom: 18 }}>
          <ShieldAlert size={18} style={{ color: "var(--danger)", flex: "none" }} />
          <div><h3>本项目试制版本已作废</h3><p>{request.voidReason ?? "该试制版本被判定为绑定不通过。"} 作废时间：{formatDateTime(request.voidedAt)}。仍处于待审批的绑定电子流提交人会在个人工作台收到撤销提醒。</p></div>
        </div>
      )}

      <div className="two-col">
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <section className="card">
            <div className="card-header"><div><h2 style={{ fontSize: 18 }}>本项目节点绑定要求</h2><p className="small muted" style={{ marginTop: 3 }}>只有本项目使用的测试节点需要完成设备条码绑定，通过数量按审批通过的条码数计算。</p></div><span className="small muted">{passed}/{requirements.length} 节点通过</span></div>
            <div className="card-body" style={{ paddingTop: 14 }}>
              <div style={{ marginBottom: 16 }}><ProgressBar value={passed} max={requirements.length} /></div>
              {requirements.map((requirement) => (
                <div className="binding-requirement" key={requirement.id}>
                  <div className="split-row" style={{ alignItems: "flex-start" }}>
                    <div>
                      <div className="toolbar" style={{ gap: 7 }}>
                        <span className="chip">{requirement.nodeName}</span>
                        {requirement.status === "PASSED" ? <Badge tone="emerald" dot>绑定通过</Badge> : <Badge tone="amber" dot>待绑定</Badge>}
                        <span className="small muted">通过条码 {requirement.approvedCount}/{requirement.requiredCount}</span>
                      </div>
                      <div className="toolbar" style={{ gap: 12, marginTop: 5, fontSize: 11, color: "var(--muted)" }}>
                        <span>绑定责任人 {requirement.bindingOwnerName ?? "未配置"}</span>
                        <span>审批人范围 {requirement.approverOptions.map((approver) => approver.userName).join(" / ") || "未配置"}</span>
                      </div>
                    </div>
                    {request.status === "TRIAL" && requirement.status === "PENDING" && canSubmitBindingFlow(user, requirement.bindingOwnerId) && (
                      <div style={{ minWidth: 360 }}>
                        <BindingFlowForm requirementId={requirement.id} requestId={requestId} approvers={requirement.approverOptions} currentUserId={user.id} />
                      </div>
                    )}
                  </div>

                  <div className="binding-flow-list">
                    {requirement.flows.length === 0 ? (
                      <span className="small muted">暂无绑定电子流。</span>
                    ) : requirement.flows.map((flow) => {
                      const meta = BINDING_FLOW_STATUS_META[flow.status as BindingFlowStatus];
                      const canApprove = request.status === "TRIAL" && flow.status === "PENDING" && canApproveBindingFlow(user, flow.approverId) && flow.submittedById !== user.id;
                      const canCancel = (request.status === "TRIAL" || request.status === "VOID") && flow.status === "PENDING" && (flow.submittedById === user.id || manager);
                      return (
                        <div className="binding-flow-row" key={flow.id}>
                          <div className="toolbar" style={{ gap: 7, flexWrap: "wrap" }}>
                            <Link2 size={13} style={{ color: "var(--muted-light)" }} />
                            <span className="mono" style={{ fontSize: 11, fontWeight: 600 }}>{flow.flowNo}</span>
                            <Badge tone={meta?.tone ?? "slate"}>{meta?.label ?? flow.status}</Badge>
                            <span className="small">条码 {flow.barcodes.length} 个</span>
                            {flow.webUrl && <ExternalLink href={flow.webUrl} className="flow-web-link">网页电子流</ExternalLink>}
                          </div>
                          {flow.barcodes.length > 0 && (
                            <details className="barcode-details">
                              <summary>查看绑定条码</summary>
                              <div className="barcode-chip-list">
                                {flow.barcodes.map((barcode) => <span className="mono barcode-chip" key={barcode}>{barcode}</span>)}
                              </div>
                            </details>
                          )}
                          <div className="small muted" style={{ marginTop: 4 }}>
                            {flow.submittedByName ?? "—"} 提交 · 审批人 {flow.approverName ?? "—"} · {formatDateTime(flow.submittedAt)}
                            {flow.reviewComment ? ` · ${flow.reviewComment}` : ""}
                          </div>
                          {(canApprove || canCancel) && (
                            <div className="binding-flow-actions">
                              {canApprove && (
                                <details>
                                  <summary className="button button-primary button-sm" style={{ listStyle: "none" }}>审批电子流</summary>
                                  <div style={{ marginTop: 8, minWidth: 340 }}>
                                    <ActionForm action={decideBindingFlowAction} hidden={{ flowId: flow.id, requestId }} submitText="审批通过" submitName="decision" submitValue="APPROVED" secondarySubmit={{ text: "审批驳回", value: "REJECTED", variant: "outline-danger" }} submitClassName="button-sm">
                                      <label className="field"><span className="label">审批意见 <span className="required-mark">*</span></span><textarea className="textarea" name="comment" required minLength={2} placeholder="说明本次电子流审批结论。" /></label>
                                    </ActionForm>
                                  </div>
                                </details>
                              )}
                              {canCancel && (
                                <ActionForm action={cancelBindingFlowAction} hidden={{ flowId: flow.id, requestId, reason: "提交人撤销绑定电子流" }} submitText="撤销电子流" submitVariant="ghost" submitClassName="button-sm" confirmMessage="确认撤销该绑定电子流？" />
                              )}
                            </div>
                          )}
                          {request.status === "VOID" && flow.status === "PENDING" && flow.submittedById === user.id && (
                            <div className="risk-callout" data-tone="danger" style={{ marginTop: 7 }}>试制版本已作废，请及时撤销此绑定电子流。</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <section className="card"><div className="card-header"><div><h2 style={{ fontSize: 16 }}>项目版本信息</h2></div></div><div className="card-body" style={{ paddingTop: 13 }}>
            <dl className="detail-list">
              <div className="detail-row"><dt>项目</dt><dd>{request.projectName}</dd></div>
              <div className="detail-row"><dt>软件包</dt><dd>{request.packageName}</dd></div>
              <div className="detail-row"><dt>版本</dt><dd className="mono">{request.version}</dd></div>
              <div className="detail-row"><dt>发布试制电子流</dt><dd>{request.trialFormNo ?? "—"}</dd></div>
              <div className="detail-row"><dt>试制发布</dt><dd>{formatDateTime(request.trialReleasedAt)}</dd></div>
              <div className="detail-row"><dt>归档地址</dt><dd><ExternalLink href={request.archiveUrl}>下载归档</ExternalLink></dd></div>
            </dl>
            <hr className="divider" style={{ margin: "12px 0" }} />
            <p className="note">{request.changeSummary}</p>
          </div></section>

          {request.status === "PENDING_FORMAL" && (
            <section className="card"><div className="card-body"><div className="toolbar" style={{ gap: 7 }}><CheckCircle2 size={17} style={{ color: "var(--brand)" }} /><h3 style={{ fontSize: 13 }}>本项目绑定验证已完成</h3></div><p className="note" style={{ marginTop: 6 }}>本项目全部节点绑定条码数量已达到要求，可以提交本项目的转正电子流。</p><Link href="/formal" className="button button-primary button-sm" style={{ marginTop: 12 }}>前往转正发布 <ArrowRight size={12} /></Link></div></section>
          )}

          {manager && request.status === "TRIAL" && (
            <section className="card"><div className="card-header"><div><h2 style={{ fontSize: 16 }}>作废本项目试制版本</h2><p className="small muted" style={{ marginTop: 3 }}>绑定验证不通过时，可作废本项目试制版本；系统会提醒待审批电子流提交人撤销。</p></div></div><div className="card-body" style={{ paddingTop: 12 }}>
              <details><summary style={{ cursor: "pointer", color: "var(--danger)", fontSize: 12, fontWeight: 600 }}>填写原因并作废</summary><div style={{ marginTop: 12 }}>
                <ActionForm action={voidTrialAction} hidden={{ requestId }} submitText="确认作废本项目试制版本" submitVariant="danger" confirmMessage="确认作废本项目试制版本？待审批的绑定电子流需要提交人撤销。">
                  <label className="field"><span className="label">作废原因</span><textarea className="textarea" name="reason" required minLength={5} placeholder="说明绑定验证不通过的原因。" /></label>
                </ActionForm>
              </div></details>
            </div></section>
          )}

          <div className="muted-panel">绑定验证按项目节点运行：节点责任人可在一个电子流内添加多个设备条码，并可多次提交电子流；审批通过的条码数量达到节点要求后节点通过。审批结果会出现在提交人的个人工作台。</div>
        </aside>
      </div>
    </>
  );
}
