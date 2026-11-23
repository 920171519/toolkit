import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, ChevronDown, Link2, ShieldAlert } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { canApproveBindingFlow, canSubmitBindingFlow } from "@/lib/permissions";
import { canAccessProjectPage, canManageProjectWorkflowForProject } from "@/lib/access";
import { requireWorkflowProject } from "@/lib/project-scope";
import { workflowHref } from "@/lib/workflow-links";
import { trialQueueParams } from "@/lib/trial-queue";
import { getWorkflowListState } from "@/lib/workflow-list";
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
import { ReleaseFlowEvidence } from "@/components/release-flow-evidence";
import { releaseFlowUrl } from "@/lib/release-flow";
import { BindingFlowForm } from "@/components/binding-flow-form";
import { FormDialog } from "@/components/form-dialog";
import { Badge, EmptyState, ExternalLink, FlashMessage, PageHeader, ProgressBar } from "@/components/ui";
import styles from "@/components/workflow-queue.module.css";

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
  const listState = { ...getWorkflowListState(search), ...trialQueueParams(search), view: "binding" };
  const actionFields = { requestId, scopeProjectId, ...listState };
  const archived = request.projectStatus === "ARCHIVED";
  const manager = !archived && canManageProjectWorkflowForProject(user, request.projectId);
  const passed = requirements.filter((requirement) => requirement.status === "PASSED").length;
  const waived = requirements.filter((requirement) => requirement.waivedAt !== null).length;
  const pendingDecision = !archived && request.status === "TRIAL" && request.bindingMode === "PENDING" && requirements.length > 0;
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
        title={`${request.packageName} ${request.version} · 绑定验证`}
        description={<>
          {request.projectName} · {releaseFlowUrl(request.trialFormNo)
            ? <ReleaseFlowEvidence value={request.trialFormNo} label="查看试制电子流" />
            : <>试制电子流 {request.trialFormNo ?? "—"}</>} · 发布于 {formatDateTime(request.trialReleasedAt)}
        </>}
        actions={<><Link href={workflowHref("/trial", scopeProjectId, listState) + "#binding-queue"} prefetch={false} className="button button-secondary"><ArrowLeft size={14} />返回节点绑定</Link><Link href={workflowHref(`/versions/${request.versionId}`, scopeProjectId, { returnTo: listState.returnTo })} prefetch={false} className="button button-secondary">版本全链路</Link><Badge tone={transferStatusMeta.tone} dot>{transferStatusMeta.label}</Badge></>}
      />
      <FlashMessage notice={notice} />

      {request.status === "VOID" && (
        <div className="workflow-banner" data-tone="danger" style={{ marginBottom: 16 }}>
          <ShieldAlert size={18} style={{ color: "var(--danger)", flex: "none" }} />
          <div><h3>本项目试制版本已作废</h3><p>{request.voidReason ?? "该试制版本被判定为绑定不通过。"} 作废时间：{formatDateTime(request.voidedAt)}。{riskTestVoided ? "待审批或已通过的绑定电子流提交人会收到撤销提醒。" : "待审批的绑定电子流提交人会收到撤销提醒。"}</p></div>
        </div>
      )}

      {!archived && request.isOverdue > 0 && request.status !== "VOID" && request.status !== "FORMAL" && (
        <div className="risk-callout" data-tone="danger" style={{ marginBottom: 12 }}>已超期 · 试制发布超过 {request.trialOverdueDays} 天，尚未转正</div>
      )}
      {riskRelease && request.status !== "VOID" && (
        <div className="risk-callout" style={{ marginBottom: 16 }}>
          <strong>风险发布</strong> · {request.riskConclusion ?? "未关联集成测试批次"}
          {request.ongoingTestCount > 0 && <p className="small" style={{ marginTop: 4 }}>仍有 {request.ongoingTestCount} 个项目的已安排测试未结束，完成前无法转正。</p>}
        </div>
      )}

      {pendingDecision && <section className={styles.nextAction}>
        <div className={styles.grow}>
          <h2>{manager ? "绑定推送决策" : "等待软件经理确认绑定方式"}</h2>
          {manager && <p>推送后，所有使用项目的节点责任人会收到待办。</p>}
        </div>
        {manager && <div className={styles.cardActions}>
          <ActionForm action={pushBindingTasksAction} hidden={actionFields} submitText="推送绑定任务" submitClassName="button-sm" className="inline-action-form" />
          <FormDialog label={request.ongoingTestCount > 0 ? "无需绑定，等待测试完成" : "无需绑定，直接进入待转正"} title="登记整版无需绑定" description={request.ongoingTestCount > 0 ? "全部使用项目将跳过节点绑定。已安排的测试结束后，才能转正。" : "全部使用项目将跳过节点绑定，版本进入待转正。"} triggerClassName="button button-secondary button-sm" cancelLabel="取消">
            <ActionForm action={skipBindingAction} hidden={actionFields} submitText="确认无需绑定" submitVariant="secondary">
              <label className="field"><span className="label">免绑原因 <span className="required-mark" aria-hidden="true">*</span></span><textarea className="textarea" name="reason" required minLength={5} /></label>
            </ActionForm>
          </FormDialog>
        </div>}
      </section>}

      {!archived && request.status === "PENDING_FORMAL" && <section className={styles.nextAction}>
        <h2>已满足转正条件</h2>
        {manager ? <Link href={workflowHref("/formal", scopeProjectId, { returnTo: listState.returnTo })} prefetch={false} className="button button-primary button-sm">前往转正发布 <ArrowRight size={12} aria-hidden="true" /></Link> : <span className="small muted">待软件经理发布</span>}
      </section>}

      <div className={styles.detailColumns}>
        <div className={styles.stack}>
          <section className="card">
            <div className="card-header"><h2 className={styles.tableHeading}>本项目节点绑定</h2><span className="small muted">{passed}/{requirements.length} 节点通过{waived > 0 ? ` · ${waived} 个节点免绑` : ""}</span></div>
            <div className="card-body" style={{ paddingTop: 12 }}>
              {requirements.length > 0 && <div style={{ marginBottom: 12 }}><ProgressBar value={passed + waived} max={requirements.length} /></div>}
              {requirements.length === 0 ? <EmptyState title="该版本没有节点绑定记录" /> : <div className={styles.nodeList}>
                {requirements.map((requirement) => {
                  const pending = !archived && requirement.status === "PENDING" && requirement.pushedAt !== null && request.status === "TRIAL";
                  const canSubmit = pending && canSubmitBindingFlow(user, requirement.bindingOwnerId);
                  const canWaive = pending && (manager || requirement.bindingOwnerId === user.id);
                  const needsWithdrawal = (status: string) => status === "PENDING" || (riskTestVoided && status === "APPROVED");
                  const canReview = (flow: typeof requirement.flows[number]) => !archived && request.status === "TRIAL" && requirement.waivedAt === null && flow.status === "PENDING" && canApproveBindingFlow(user, flow.approverId) && flow.submittedById !== user.id;
                  const canWithdraw = (flow: typeof requirement.flows[number]) => (request.status === "VOID" || (!archived && request.status === "TRIAL")) && needsWithdrawal(flow.status) && (flow.submittedById === user.id || manager);
                  const pendingOpen = canSubmit || canWaive || requirement.flows.some((flow) => canReview(flow) || canWithdraw(flow));
                  return (
                    <details className="binding-table-item binding-requirement" key={requirement.id} id={`binding-node-${requirement.id}`} open={pendingOpen}>
                      <summary className={styles.nodeHeading}>
                        <span><strong>{requirement.nodeName}</strong> <span className="small muted">{requirement.approvedCount}/{requirement.requiredCount} 条码通过</span></span>
                        <span>{requirement.waivedAt ? <Badge tone="slate" dot>节点免绑</Badge> : requirement.status === "PASSED" ? <Badge tone="emerald" dot>绑定通过</Badge> : requirement.status === "CANCELLED" ? <Badge tone="slate" dot>{request.status === "VOID" ? "已关闭" : "已跳过"}</Badge> : requirement.pushedAt ? <Badge tone="amber" dot>待绑定</Badge> : <Badge tone="slate" dot>未推送</Badge>}</span>
                        <ChevronDown size={16} aria-hidden="true" />
                      </summary>
                      <div className="binding-table-body">
                        <div className={styles.rowActions}>
                          <span className="small muted">绑定责任人 {requirement.bindingOwnerName ?? "未配置"}</span>
                          <span className="small muted">审批范围 {requirement.approverOptions.map((approver) => approver.userName).join("、") || "未配置"}</span>
                        </div>
                        {requirement.waivedAt && <p className="small muted" style={{ marginBottom: 8 }}>免绑原因：{requirement.decisionReason} · {requirement.waivedByName ?? "—"} · {formatDateTime(requirement.waivedAt)}</p>}
                        {(canSubmit || canWaive) && <div className={styles.rowActions} style={{ marginTop: 10 }}>
                          {canSubmit && <FormDialog key={requirement.flows.length} label="新增绑定电子流" title={`${requirement.nodeName} · 提交绑定电子流`} triggerClassName="button button-primary button-sm" cancelLabel="取消">
                            <BindingFlowForm requirementId={requirement.id} requestId={requestId} approvers={requirement.approverOptions} currentUserId={user.id} scopeProjectId={scopeProjectId} listState={listState} />
                          </FormDialog>}
                          {canWaive && <FormDialog label="节点无需绑定" title={`${requirement.nodeName} · 确认免绑`} description="只影响当前项目的这个节点。待审批电子流会关闭，已登记的记录会保留。" triggerClassName="button button-secondary button-sm" cancelLabel="取消">
                            <ActionForm action={waiveBindingRequirementAction} hidden={{ ...actionFields, requirementId: requirement.id }} submitText="确认节点免绑">
                              <label className="field"><span className="label">免绑原因 <span className="required-mark">*</span></span><textarea className="textarea" name="reason" required minLength={5} /></label>
                            </ActionForm>
                          </FormDialog>}
                        </div>}
                        <div className="binding-flow-list">
                          {requirement.flows.length === 0 ? (
                            <span className="small muted">暂无绑定电子流。</span>
                          ) : requirement.flows.map((flow) => {
                            const meta = BINDING_FLOW_STATUS_META[flow.status as BindingFlowStatus];
                            const canApprove = canReview(flow);
                            const canCancel = canWithdraw(flow);
                            return (
                              <div className={`binding-flow-row ${styles.detailAnchor}`} key={flow.id} id={`binding-flow-${flow.id}`}>
                                <div className="toolbar" style={{ gap: 7, flexWrap: "wrap" }}>
                                  <Link2 size={13} style={{ color: "var(--muted-light)" }} />
                                  <span className="mono" style={{ fontSize: 11, fontWeight: 600 }}>{flow.flowNo}</span>
                                  <Badge tone={meta?.tone ?? "slate"}>{meta?.label ?? flow.status}</Badge>
                                  {flow.webUrl && <ExternalLink href={flow.webUrl} className="flow-web-link">网页电子流</ExternalLink>}
                                </div>
                                {flow.barcodes.length > 0 && (
                                  <details className="barcode-details">
                                    <summary>设备条码 {flow.barcodes.length} 个</summary>
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
                                      <FormDialog label="审批电子流" title={`${requirement.nodeName} · 审批 ${flow.flowNo}`} description={`${flow.submittedByName ?? "未知提交人"} · ${formatDateTime(flow.submittedAt)}`} triggerClassName="button button-primary button-sm" cancelLabel="取消">
                                        <div className={styles.releaseEvidence}>
                                          {flow.webUrl && <ExternalLink href={flow.webUrl} className="flow-web-link">查看网页电子流</ExternalLink>}
                                          <strong>本次提交的设备条码（{flow.barcodes.length}）</strong>
                                          <div className="barcode-chip-list">{flow.barcodes.map((barcode) => <span className="mono barcode-chip" key={barcode}>{barcode}</span>)}</div>
                                        </div>
                                          <ActionForm action={decideBindingFlowAction} hidden={{ ...actionFields, flowId: flow.id }} submitText="审批通过" submitName="decision" submitValue="APPROVED" secondarySubmit={{ text: "审批驳回", value: "REJECTED", variant: "outline-danger" }} submitClassName="button-sm">
                                            <label className="field"><span className="label">审批意见 <span className="required-mark" aria-hidden="true">*</span></span><textarea className="textarea" name="comment" required minLength={2} /></label>
                                          </ActionForm>
                                      </FormDialog>
                                    )}
                                    {canCancel && (
                                      <ActionForm action={cancelBindingFlowAction} hidden={{ ...actionFields, flowId: flow.id, reason: "提交人撤销绑定电子流" }} submitText="撤销电子流" submitVariant="ghost" submitClassName="button-sm" confirmMessage={`${flow.flowNo} 将标记为已撤销。请先在原网页撤销电子流。`} />
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
                      </div>
                    </details>
                  );
                })}
              </div>}
            </div>
          </section>
        </div>

        <aside className={styles.stack} aria-label="项目版本信息与操作">
          <section className="card"><div className="card-header"><h2 className={styles.tableHeading}>试制详情</h2></div><div className="card-body" style={{ paddingTop: 13 }}>
            <dl className="detail-list">
              <div className="detail-row"><dt>项目软件经理</dt><dd>{request.softwareManagerName ?? "未指定"}</dd></div>
              <div className="detail-row"><dt>发布来源</dt><dd>{riskRelease ? <Badge tone="rose">风险发布</Badge> : <Badge tone="violet">集成测试通过</Badge>}</dd></div>
              {request.batchId && <div className="detail-row"><dt>转测批次</dt><dd><Link href={workflowHref(`/integration/${request.batchId}`, scopeProjectId)} prefetch={false} className="archive-link">{request.batchCode} · {batchConclusion?.label ?? "待提交结论"}</Link></dd></div>}
              {request.status === "VOID" && request.riskConclusion && <div className="detail-row"><dt>风险结论</dt><dd>{request.riskConclusion}</dd></div>}
              <div className="detail-row"><dt>归档地址</dt><dd><ExternalLink href={request.archiveUrl}>下载归档</ExternalLink></dd></div>
            </dl>
            <hr className="divider" style={{ margin: "12px 0" }} />
            <p className="note">{request.changeSummary}</p>
          </div></section>

          {request.status !== "VOID" && request.bindingMode === "SKIPPED" && (
            <section className="card"><div className="card-body"><h2 className={styles.tableHeading}>整版免绑</h2><p className="note" style={{ marginTop: 6 }}>{request.bindingReason ?? "未记录免绑原因"}</p></div></section>
          )}

          {manager && request.status === "TRIAL" && (
            <section className="card"><div className="card-body">
              <FormDialog label="作废试制版本" title="作废共享试制版本" description="该版本将在所有使用项目中失效。待审批电子流的提交人会收到撤销提醒。" triggerClassName="button button-outline-danger button-sm" cancelLabel="取消">
                <ActionForm action={voidTrialAction} hidden={actionFields} submitText="确认作废共享试制版本" submitVariant="danger">
                  <label className="field"><span className="label">作废原因</span><textarea className="textarea" name="reason" required minLength={5} /></label>
                </ActionForm>
              </FormDialog>
            </div></section>
          )}

        </aside>
      </div>
    </>
  );
}
