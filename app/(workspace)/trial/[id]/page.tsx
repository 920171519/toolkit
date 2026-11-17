import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, CheckCircle2, Link2, ShieldAlert } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { canApproveBindingFlow, canSubmitBindingFlow } from "@/lib/permissions";
import { canManageProjectWorkflowForProject } from "@/lib/access";
import { parseFlash } from "@/lib/queries";
import { getTrialDetail } from "@/lib/workflow-queries";
import { formatDateTime } from "@/lib/format";
import {
  BINDING_FLOW_STATUS_META,
  CONCLUSION_META,
  TRANSFER_REQUEST_STATUS_META,
  type BatchConclusion,
  type BindingFlowStatus,
} from "@/lib/constants";
import {
  cancelBindingFlowAction,
  decideBindingFlowAction,
  voidTrialAction,
} from "@/lib/actions/workflow";
import { ActionForm } from "@/components/action-form";
import { BindingFlowForm } from "@/components/binding-flow-form";
import { Badge, EmptyState, ExternalLink, FlashMessage, PageHeader, ProgressBar } from "@/components/ui";

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
  const manager = canManageProjectWorkflowForProject(user, request.projectId);
  const passed = requirements.filter((requirement) => requirement.status === "PASSED").length;
  const riskRelease = request.releaseMode === "RISK" || !request.batchId;
  const batchConclusion = request.batchConclusion ? CONCLUSION_META[request.batchConclusion as BatchConclusion] : null;
  const transferStatusMeta = TRANSFER_REQUEST_STATUS_META[request.status as keyof typeof TRANSFER_REQUEST_STATUS_META] ?? {
    label: request.status === "TRIAL" ? "试制中" : request.status === "PENDING_FORMAL" ? "待转正" : request.status === "FORMAL" ? "已转正" : request.status === "VOID" ? "已作废" : request.status,
    tone: request.status === "TRIAL" ? "teal" : request.status === "FORMAL" ? "emerald" : request.status === "VOID" ? "slate" : "violet",
  };

  return (
    <>
      <PageHeader
        eyebrow="Trial / Project binding"
        title={`${request.projectName} · ${request.packageName} ${request.version}`}
        description={<>项目试制电子流 {request.trialFormNo ?? "—"} · 发布 {formatDateTime(request.trialReleasedAt)} · 项目软件经理 {request.softwareManagerName ?? "—"}</>}
        actions={<><Link href="/trial" className="button button-secondary"><ArrowLeft size={14} />返回试制队列</Link><Link href={`/versions/${request.versionId}`} className="button button-secondary">版本全链路</Link><Badge tone={transferStatusMeta.tone} dot>{transferStatusMeta.label}</Badge></>}
      />
      <FlashMessage notice={notice} />

      {request.status === "VOID" && (
        <div className="workflow-banner" data-tone="danger" style={{ marginBottom: 16 }}>
          <ShieldAlert size={18} style={{ color: "var(--danger)", flex: "none" }} />
          <div><h3>本项目试制版本已作废</h3><p>{request.voidReason ?? "该试制版本被判定为绑定不通过。"} 作废时间：{formatDateTime(request.voidedAt)}。仍处于待审批的绑定电子流提交人会在个人工作台收到撤销提醒。</p></div>
        </div>
      )}

      {riskRelease && request.status !== "VOID" && (
        <div className="risk-callout" style={{ marginBottom: 16 }}>
          <strong>风险发布版本。</strong>{request.riskConclusion ? `风险结论：${request.riskConclusion}` : "该版本没有关联集成测试批次，按风险发布处理。"}
        </div>
      )}

      <div className="two-col">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <section className="card">
            <div className="card-header"><div><h2 style={{ fontSize: 18 }}>本项目节点绑定要求</h2><p className="small muted" style={{ marginTop: 3 }}>只有本项目使用的测试节点需要完成设备条码绑定，通过数量按审批通过的条码数计算。</p></div><span className="small muted">{passed}/{requirements.length} 节点通过</span></div>
            <div className="card-body" style={{ paddingTop: 12 }}>
              {requirements.length > 0 && <div style={{ marginBottom: 12 }}><ProgressBar value={passed} max={requirements.length} /></div>}
              {requirements.length === 0 ? <EmptyState title="该版本尚未发布试制" description="版本完成集成测试并发布共享试制后，才会生成项目节点绑定要求。" /> : <div className="binding-table">
                <div className="binding-table-head">
                  <span>节点</span><span>绑定责任人</span><span>审批人范围</span><span>通过条码</span><span>状态</span><span>操作</span>
                </div>
                {requirements.map((requirement) => {
                  const pendingOpen = requirement.status === "PENDING" && (request.status === "TRIAL" || request.status === "VOID");
                  return (
                    <details className="binding-table-item binding-requirement" key={requirement.id} open={pendingOpen}>
                      <summary className="binding-table-row">
                        <span><span className="chip">{requirement.nodeName}</span></span>
                        <span className="small">{requirement.bindingOwnerName ?? "未配置"}</span>
                        <span className="small muted binding-approver-range">{requirement.approverOptions.map((approver) => approver.userName).join(" / ") || "未配置"}</span>
                        <span className="toolbar" style={{ gap: 6 }}><span className="mono small">{requirement.approvedCount}/{requirement.requiredCount}</span></span>
                        <span>{requirement.status === "PASSED" ? <Badge tone="emerald" dot>绑定通过</Badge> : <Badge tone="amber" dot>待绑定</Badge>}</span>
                        <span className="binding-row-action">展开 / 收起</span>
                      </summary>
                      <div className="binding-table-body">
                        {request.status === "TRIAL" && requirement.status === "PENDING" && canSubmitBindingFlow(user, requirement.bindingOwnerId) && (
                          <div style={{ marginBottom: 10 }}>
                            <BindingFlowForm requirementId={requirement.id} requestId={requestId} approvers={requirement.approverOptions} currentUserId={user.id} />
                          </div>
                        )}
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
                    </details>
                  );
                })}
              </div>}
            </div>
          </section>
        </div>

        <aside style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <section className="card"><div className="card-header"><div><h2 style={{ fontSize: 16 }}>项目版本信息</h2></div></div><div className="card-body" style={{ paddingTop: 13 }}>
            <dl className="detail-list">
              <div className="detail-row"><dt>项目</dt><dd>{request.projectName}</dd></div>
              <div className="detail-row"><dt>软件包</dt><dd>{request.packageName}</dd></div>
              <div className="detail-row"><dt>版本</dt><dd className="mono">{request.version}</dd></div>
              <div className="detail-row"><dt>发布来源</dt><dd>{riskRelease ? <Badge tone="rose">风险发布</Badge> : <Badge tone="violet">集成测试通过</Badge>}</dd></div>
              {request.batchId && <div className="detail-row"><dt>转测批次</dt><dd><Link href={`/integration/${request.batchId}`} className="archive-link">{request.batchCode} · {batchConclusion?.label ?? "已提交"}</Link></dd></div>}
              {request.riskConclusion && <div className="detail-row"><dt>风险结论</dt><dd>{request.riskConclusion}</dd></div>}
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
            <section className="card"><div className="card-header"><div><h2 style={{ fontSize: 16 }}>作废共享试制版本</h2><p className="small muted" style={{ marginTop: 3 }}>试制按软件包版本全项目共享；作废后全部项目的该试制版本都会失效，并提醒待审批电子流提交人撤销。</p></div></div><div className="card-body" style={{ paddingTop: 12 }}>
              <details><summary style={{ cursor: "pointer", color: "var(--danger)", fontSize: 12, fontWeight: 600 }}>填写原因并作废</summary><div style={{ marginTop: 12 }}>
                <ActionForm action={voidTrialAction} hidden={{ requestId }} submitText="确认作废共享试制版本" submitVariant="danger" confirmMessage="确认作废该软件包的共享试制版本？全部项目的待审批绑定电子流都需要提交人撤销。">
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
