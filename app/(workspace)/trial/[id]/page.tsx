import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, CheckCircle2, Link2, ShieldAlert } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { canApproveBindingFlow, canSubmitBindingFlow } from "@/lib/permissions";
import { canAccessProjectPage, canManageProjectWorkflowForProject } from "@/lib/access";
import { requireWorkflowProject } from "@/lib/project-scope";
import { workflowHref } from "@/lib/workflow-links";
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
  pushBindingTasksAction,
  skipBindingAction,
  waiveBindingRequirementAction,
  voidTrialAction,
} from "@/lib/actions/workflow";
import { ActionForm } from "@/components/action-form";
import { BindingFlowForm } from "@/components/binding-flow-form";
import { FormDialog } from "@/components/form-dialog";
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
  if (!canAccessProjectPage(user, request.projectId)) notFound();
  const scopeProjectId = requireWorkflowProject(user, search.project, request.projectId)?.id;
  const manager = canManageProjectWorkflowForProject(user, request.projectId);
  const passed = requirements.filter((requirement) => requirement.status === "PASSED").length;
  const waived = requirements.filter((requirement) => requirement.waivedAt !== null).length;
  const riskTestVoided = request.voidKind === "RISK_TEST_FAILURE";
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
        actions={<><Link href={workflowHref("/trial", scopeProjectId)} className="button button-secondary"><ArrowLeft size={14} />返回试制队列</Link><Link href={workflowHref(`/versions/${request.versionId}`, scopeProjectId)} className="button button-secondary">版本全链路</Link><Badge tone={transferStatusMeta.tone} dot>{transferStatusMeta.label}</Badge></>}
      />
      <FlashMessage notice={notice} />

      {request.status === "VOID" && (
        <div className="workflow-banner" data-tone="danger" style={{ marginBottom: 16 }}>
          <ShieldAlert size={18} style={{ color: "var(--danger)", flex: "none" }} />
          <div><h3>本项目试制版本已作废</h3><p>{request.voidReason ?? "该试制版本被判定为绑定不通过。"} 作废时间：{formatDateTime(request.voidedAt)}。{riskTestVoided ? "待审批或已通过的绑定电子流提交人会收到撤销提醒。" : "待审批的绑定电子流提交人会收到撤销提醒。"}</p></div>
        </div>
      )}

      {request.isOverdue > 0 && request.status !== "VOID" && request.status !== "FORMAL" && (
        <div className="risk-callout" data-tone="danger" style={{ marginBottom: 12 }}>该试制版本发布超过 {request.trialOverdueDays} 天仍未转正，已超期，请尽快推进绑定和转正，或在软件版本总览中作废该版本。</div>
      )}
      {riskRelease && request.status !== "VOID" && (
        <div className="risk-callout" style={{ marginBottom: 16 }}>
          <strong>风险发布版本。</strong>{request.riskConclusion ? `风险结论：${request.riskConclusion}` : "该版本没有关联集成测试批次，按风险发布处理。"}
          {request.ongoingTestCount > 0 && <p className="small" style={{ marginTop: 4 }}>仍有 {request.ongoingTestCount} 个项目的已安排测试未结束，完成前无法转正。</p>}
        </div>
      )}

      <div className="two-col">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <section className="card">
            <div className="card-header"><div><h2 style={{ fontSize: 18 }}>本项目节点绑定要求</h2><p className="small muted" style={{ marginTop: 3 }}>展开节点可查看电子流和审批记录。</p></div><span className="small muted">{passed}/{requirements.length} 节点通过{waived > 0 ? ` · ${waived} 个节点免绑` : ""}</span></div>
            <div className="card-body" style={{ paddingTop: 12 }}>
              {requirements.length > 0 && <div style={{ marginBottom: 12 }}><ProgressBar value={passed + waived} max={requirements.length} /></div>}
              {requirements.length === 0 ? <EmptyState title="该版本没有节点绑定记录" description="发布共享试制后可在这里查看绑定要求。" /> : <div className="binding-table">
                <div className="binding-table-head">
                  <span>节点</span><span>绑定责任人</span><span>审批人范围</span><span>通过条码</span><span>状态</span><span>操作</span>
                </div>
                {requirements.map((requirement) => {
                  const pending = requirement.status === "PENDING" && requirement.pushedAt !== null && request.status === "TRIAL";
                  const canSubmit = pending && canSubmitBindingFlow(user, requirement.bindingOwnerId);
                  const canWaive = pending && (manager || requirement.bindingOwnerId === user.id);
                  const needsWithdrawal = (status: string) => status === "PENDING" || (riskTestVoided && status === "APPROVED");
                  const pendingOpen = pending || (request.status === "VOID" && requirement.flows.some((flow) => needsWithdrawal(flow.status) && (flow.submittedById === user.id || manager)));
                  return (
                    <details className="binding-table-item binding-requirement" key={requirement.id} open={pendingOpen}>
                      <summary className="binding-table-row">
                        <span><span className="chip">{requirement.nodeName}</span></span>
                        <span className="small">{requirement.bindingOwnerName ?? "未配置"}</span>
                        <span className="small muted binding-approver-range">{requirement.approverOptions.map((approver) => approver.userName).join(" / ") || "未配置"}</span>
                        <span className="toolbar" style={{ gap: 6 }}><span className="mono small">{requirement.approvedCount}/{requirement.requiredCount}</span></span>
                        <span>{requirement.waivedAt ? <Badge tone="slate" dot>节点免绑</Badge> : requirement.status === "PASSED" ? <Badge tone="emerald" dot>绑定通过</Badge> : requirement.status === "CANCELLED" ? <Badge tone="slate" dot>{request.status === "VOID" ? "已关闭" : "已跳过"}</Badge> : requirement.pushedAt ? <Badge tone="amber" dot>待绑定</Badge> : <Badge tone="slate" dot>未推送</Badge>}</span>
                        <span className="binding-row-action">展开 / 收起</span>
                      </summary>
                      <div className="binding-table-body">
                        {requirement.waivedAt && <p className="small muted" style={{ marginBottom: 8 }}>免绑原因：{requirement.decisionReason} · {requirement.waivedByName ?? "—"} · {formatDateTime(requirement.waivedAt)}</p>}
                        <div className="binding-flow-list">
                          {requirement.flows.length === 0 ? (
                            <span className="small muted">暂无绑定电子流。</span>
                          ) : requirement.flows.map((flow) => {
                            const meta = BINDING_FLOW_STATUS_META[flow.status as BindingFlowStatus];
                            const canApprove = request.status === "TRIAL" && requirement.waivedAt === null && flow.status === "PENDING" && canApproveBindingFlow(user, flow.approverId) && flow.submittedById !== user.id;
                            const canCancel = (request.status === "TRIAL" || request.status === "VOID") && needsWithdrawal(flow.status) && (flow.submittedById === user.id || manager);
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
                                          <ActionForm action={decideBindingFlowAction} hidden={{ flowId: flow.id, requestId, scopeProjectId }} submitText="审批通过" submitName="decision" submitValue="APPROVED" secondarySubmit={{ text: "审批驳回", value: "REJECTED", variant: "outline-danger" }} submitClassName="button-sm">
                                            <label className="field"><span className="label">审批意见 <span className="required-mark">*</span></span><textarea className="textarea" name="comment" required minLength={2} placeholder="说明本次电子流审批结论。" /></label>
                                          </ActionForm>
                                        </div>
                                      </details>
                                    )}
                                    {canCancel && (
                                      <ActionForm action={cancelBindingFlowAction} hidden={{ flowId: flow.id, requestId, scopeProjectId, reason: "提交人撤销绑定电子流" }} submitText="撤销电子流" submitVariant="ghost" submitClassName="button-sm" confirmMessage="确认撤销该绑定电子流？" />
                                    )}
                                  </div>
                                )}
                                {request.status === "VOID" && needsWithdrawal(flow.status) && flow.submittedById === user.id && (
                                  <div className="risk-callout" data-tone="danger" style={{ marginTop: 7 }}>试制版本已作废，请在原网页撤销绑定电子流，再在此登记撤销。</div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        {(canSubmit || canWaive) && <div className="toolbar" style={{ marginTop: 10 }}>
                          {canSubmit && <FormDialog key={requirement.flows.length} label="新增绑定电子流" title={`${requirement.nodeName} · 提交绑定电子流`} triggerClassName="button button-primary button-sm" cancelLabel="取消">
                            <BindingFlowForm requirementId={requirement.id} requestId={requestId} approvers={requirement.approverOptions} currentUserId={user.id} scopeProjectId={scopeProjectId} />
                          </FormDialog>}
                          {canWaive && <FormDialog label="节点无需绑定" title={`${requirement.nodeName} · 确认免绑`} description="只影响当前项目的这个节点。待审批的绑定电子流将关闭，已登记记录保留。" triggerClassName="button button-secondary button-sm" cancelLabel="取消">
                            <ActionForm action={waiveBindingRequirementAction} hidden={{ requirementId: requirement.id, requestId, scopeProjectId }} submitText="确认节点免绑">
                              <label className="field"><span className="label">免绑原因 <span className="required-mark">*</span></span><textarea className="textarea" name="reason" required minLength={5} /></label>
                            </ActionForm>
                          </FormDialog>}
                        </div>}
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
              {request.batchId && <div className="detail-row"><dt>转测批次</dt><dd><Link href={workflowHref(`/integration/${request.batchId}`, scopeProjectId)} className="archive-link">{request.batchCode} · {batchConclusion?.label ?? "待提交结论"}</Link></dd></div>}
              {request.riskConclusion && <div className="detail-row"><dt>风险结论</dt><dd>{request.riskConclusion}</dd></div>}
              <div className="detail-row"><dt>发布试制电子流</dt><dd>{request.trialFormNo ?? "—"}</dd></div>
              <div className="detail-row"><dt>试制发布</dt><dd>{formatDateTime(request.trialReleasedAt)}</dd></div>
              <div className="detail-row"><dt>归档地址</dt><dd><ExternalLink href={request.archiveUrl}>下载归档</ExternalLink></dd></div>
            </dl>
            <hr className="divider" style={{ margin: "12px 0" }} />
            <p className="note">{request.changeSummary}</p>
          </div></section>

          {request.status === "PENDING_FORMAL" && (
            <section className="card"><div className="card-body"><div className="toolbar" style={{ gap: 7 }}><CheckCircle2 size={17} style={{ color: "var(--brand)" }} /><h3 style={{ fontSize: 13 }}>已满足转正条件</h3></div><p className="note" style={{ marginTop: 6 }}>可为全部使用项目提交一次转正电子流。</p><Link href={workflowHref("/formal", scopeProjectId)} className="button button-primary button-sm" style={{ marginTop: 12 }}>前往转正发布 <ArrowRight size={12} /></Link></div></section>
          )}

          {manager && request.status === "TRIAL" && request.bindingMode === "PENDING" && requirements.length > 0 && (
            <section className="card"><div className="card-header"><div><h2 style={{ fontSize: 16 }}>绑定推送决策</h2><p className="small muted" style={{ marginTop: 3 }}>共享试制已发布，但尚未向绑定责任人推送待办。请确认这个版本是否需要绑定验证。</p></div><Badge tone="amber">待决定</Badge></div><div className="card-body" style={{ paddingTop: 12 }}>
              <div className="notice-panel" style={{ marginBottom: 12 }}>需要绑定时，推送后各项目节点责任人会收到待办。整版本无需绑定时，填写理由并确认即可。</div>
              <div className="toolbar" style={{ gap: 8, flexWrap: "wrap" }}>
                <ActionForm action={pushBindingTasksAction} hidden={{ requestId, scopeProjectId }} submitText="推送绑定任务" submitClassName="button-sm" />
              </div>
              <details style={{ marginTop: 12 }}><summary style={{ cursor: "pointer", color: "var(--brand)", fontSize: 12, fontWeight: 600 }}>{request.ongoingTestCount > 0 ? "无需绑定，等待测试完成" : "无需绑定，直接进入待转正"}</summary><div style={{ marginTop: 10 }}>
                <ActionForm action={skipBindingAction} hidden={{ requestId, scopeProjectId }} submitText="确认无需绑定" submitVariant="secondary" submitClassName="button-sm" confirmMessage="确认该版本的全部使用项目无需绑定验证？">
                  <label className="field"><span className="label">不绑定原因 <span className="required-mark">*</span></span><textarea className="textarea" name="reason" required minLength={5} placeholder="例如：该版本仅修复配置项，已在集成测试中完成整机验证，无需重复绑定。" /></label>
                </ActionForm>
              </div></details>
            </div></section>
          )}

          {request.status === "TRIAL" && request.bindingMode === "PUSHED" && (
            <section className="card"><div className="card-body"><div className="toolbar" style={{ gap: 7 }}><CheckCircle2 size={17} style={{ color: "var(--brand)" }} /><h3 style={{ fontSize: 13 }}>绑定任务已推送</h3></div><p className="note" style={{ marginTop: 6 }}>全部使用项目节点的绑定责任人已收到待办，等待提交电子流。</p></div></section>
          )}

          {request.status !== "VOID" && request.bindingMode === "SKIPPED" && (
            <section className="card"><div className="card-body"><div className="toolbar" style={{ gap: 7 }}><CheckCircle2 size={17} style={{ color: "var(--brand)" }} /><h3 style={{ fontSize: 13 }}>本版本无需绑定验证</h3></div><p className="note" style={{ marginTop: 6 }}>免绑原因：{request.bindingReason ?? "—"}。{request.status === "TRIAL" ? "等待已安排的测试结束。" : "免绑决定适用于全部使用项目。"}</p></div></section>
          )}

          {manager && request.status === "TRIAL" && (
            <section className="card"><div className="card-header"><div><h2 style={{ fontSize: 16 }}>作废共享试制版本</h2><p className="small muted" style={{ marginTop: 3 }}>试制按软件包版本全项目共享；作废后全部项目的该试制版本都会失效，并提醒待审批电子流提交人撤销。</p></div></div><div className="card-body" style={{ paddingTop: 12 }}>
              <details><summary style={{ cursor: "pointer", color: "var(--danger)", fontSize: 12, fontWeight: 600 }}>填写原因并作废</summary><div style={{ marginTop: 12 }}>
                <ActionForm action={voidTrialAction} hidden={{ requestId, scopeProjectId }} submitText="确认作废共享试制版本" submitVariant="danger" confirmMessage="确认作废该软件包的共享试制版本？全部项目的待审批绑定电子流都需要提交人撤销。">
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
