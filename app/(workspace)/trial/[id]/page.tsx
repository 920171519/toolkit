import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, ChevronDown, Link2, ShieldAlert } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { BINDING_BARCODE_FAILURE_REASON_LIMIT, bindingBarcodeProgress, isActiveBindingFlow } from "@/lib/binding-barcode-results";
import { bindingFlowApprovalBlocker, canSubmitBindingFlow } from "@/lib/permissions";
import { bindingReleaseAvailability, bindingRequirementAvailability } from "@/lib/binding-availability";
import { canAccessProjectPage, canConfirmBindingNodeForProject, canManageProjectWorkflowForProject, getReadableLinkedBatchEvidence } from "@/lib/access";
import { packageIdentity } from "@/lib/package-identity";
import { requireWorkflowProject } from "@/lib/project-scope";
import { workflowHref } from "@/lib/workflow-links";
import { trialQueueParams } from "@/lib/trial-queue";
import { getWorkflowListState } from "@/lib/workflow-list";
import { parseFlash } from "@/lib/flash";
import { createTrialDetailReader, getPendingBindingFlowCount } from "@/lib/binding-queries";
import { getFormalReleaseGuidance } from "@/lib/release-guidance";
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
  confirmBindingRequirementAction,
  decideBindingFlowAction,
  pushBindingTasksAction,
  skipBindingAction,
  waiveBindingRequirementAction,
} from "@/lib/actions/workflow";
import { ActionForm } from "@/components/action-form";
import { ReleaseFlowEvidence } from "@/components/release-flow-evidence";
import { releaseFlowUrl } from "@/lib/release-flow";
import { BindingFlowForm } from "@/components/binding-flow-form";
import { BindingBarcodeEditor } from "@/components/binding-barcode-editor";
import { BindingBarcodeList } from "@/components/binding-barcode-list";
import { FormDialog } from "@/components/form-dialog";
import { GuidanceDialog, type GuidanceItem } from "@/components/guidance-dialog";
import { TrialBindingFocus } from "@/components/trial-binding-focus";
import { VersionVoidDialog } from "@/components/version-void-dialog";
import { Badge, EmptyState, ExternalLink, FlashMessage, PageHeader, ProgressBar } from "@/components/ui";
import styles from "@/components/workflow-queue.module.css";
import barcodeStyles from "@/components/binding-barcode-list.module.css";

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
  const trialDetails = createTrialDetailReader(user);
  const data = trialDetails.getReadableTrialDetail(requestId);
  if (!data) notFound();
  const search = await searchParams;
  const notice = parseFlash(search.flash, search.tone === "error" ? "error" : "success");
  const { request, requirements } = data;
  const releaseAvailability = bindingReleaseAvailability({
    projectStatus: request.projectStatus,
    requestStatus: request.status,
    versionStatus: request.versionStatus,
  });
  const archived = releaseAvailability === "ARCHIVED";
  const canEditFlows = releaseAvailability === "OPEN";
  const canReadProject = canAccessProjectPage(user, request.projectId);
  const scopeProjectId = requireWorkflowProject(user, search.project, request.projectId, true)?.id;
  const listState = { ...getWorkflowListState(search), ...trialQueueParams(search), view: "binding" };
  const actionFields = { requestId, scopeProjectId, ...listState };
  const manager = !archived && canManageProjectWorkflowForProject(user, request.projectId);
  const canConfirmNodes = canEditFlows && canConfirmBindingNodeForProject(user, request.packageOwnerId, request.projectId);
  const passed = requirements.filter((requirement) => requirement.confirmedAt !== null).length;
  const waived = requirements.filter((requirement) => requirement.waivedAt !== null).length;
  const pendingDecision = canEditFlows && request.status === "TRIAL" && request.bindingMode === "PENDING" && requirements.length > 0;
  const riskRelease = request.releaseMode === "RISK" || !request.batchId;
  const identity = packageIdentity({ name: request.packageName, code: request.packageCode });
  const formalGuidance = canEditFlows ? getFormalReleaseGuidance(trialDetails, request.versionId, {
    projectId: request.projectId, returnTo: listState.returnTo, bindingListState: listState,
  }) : null;
  const pendingReviews = canEditFlows && request.status === "PENDING_FORMAL"
    ? formalGuidance?.pendingFlowCount ?? getPendingBindingFlowCount(request.versionId)
    : 0;
  const batch = canReadProject ? getReadableLinkedBatchEvidence(user, request) : null;
  const batchConclusion = batch?.batchConclusion ? CONCLUSION_META[batch.batchConclusion as BatchConclusion] : null;
  const transferStatusMeta = TRANSFER_REQUEST_STATUS_META[request.status as keyof typeof TRANSFER_REQUEST_STATUS_META] ?? {
    label: request.status === "TRIAL" ? "试制中" : request.status === "PENDING_FORMAL" ? "待转正" : request.status === "FORMAL" ? "已转正" : request.status === "VOID" ? "已作废" : request.status,
    tone: request.status === "TRIAL" ? "teal" : request.status === "FORMAL" ? "emerald" : request.status === "VOID" ? "slate" : "violet",
  };

  return (
    <>
      <TrialBindingFocus detail />
      <PageHeader
        title={`${identity.code} ${request.version} · 绑定验证`}
        description={<>
          {identity.name !== identity.code && `${identity.name} · `}
          {request.projectName} · {releaseFlowUrl(request.trialFormNo)
            ? <ReleaseFlowEvidence value={request.trialFormNo} label="查看试制电子流" />
            : <>试制电子流 {request.trialFormNo ?? "—"}</>} · 发布于 {formatDateTime(request.trialReleasedAt)}
        </>}
        actions={<>
          <Link href={workflowHref("/trial", scopeProjectId, listState) + "#binding-queue"} prefetch={false} className="button button-secondary"><ArrowLeft size={14} />返回节点绑定</Link>
          <Link href={workflowHref(`/versions/${request.versionId}`, scopeProjectId, { returnTo: listState.returnTo })} prefetch={false} className="button button-secondary">版本全链路</Link>
          {manager && canEditFlows && <VersionVoidDialog versionId={request.versionId} code={identity.code} version={request.version}
            buttonLabel="作废试制版本" returnFields={{ ...actionFields, voidFrom: "trial" }}
            description="该版本将在所有关联项目中失效。待审批或已通过的绑定电子流提交人会收到撤销提醒。批次、报告和电子流记录会保留。" />}
          <Badge tone={transferStatusMeta.tone} dot>{transferStatusMeta.label}</Badge>
        </>}
      />
      <FlashMessage notice={notice} />

      {request.status === "VOID" && (
        <div className="workflow-banner" data-tone="danger" style={{ marginBottom: 16 }}>
          <ShieldAlert size={18} style={{ color: "var(--danger)", flex: "none" }} />
          <div><h3>本项目试制版本已作废</h3><p>{request.voidReason ?? "该版本已失效。"} 作废时间：{formatDateTime(request.voidedAt)}。待审批或已通过的绑定电子流提交人会收到撤销提醒。</p></div>
        </div>
      )}

      {canEditFlows && request.isOverdue > 0 && (
        <div className="risk-callout" data-tone="danger" style={{ marginBottom: 12 }}>已超期 · 试制发布超过 {request.trialOverdueDays} 天，尚未转正</div>
      )}
      {riskRelease && request.status !== "VOID" && (
        <div className="risk-callout" style={{ marginBottom: 16 }}>
          <strong>风险发布</strong> · {request.riskConclusion ?? "未关联集成测试批次"}
          {request.ongoingTestCount > 0 && <p className="small" style={{ marginTop: 4 }}>仍有 {request.ongoingTestCount} 个项目的已安排测试未结束，完成前无法转正。</p>}
        </div>
      )}

      {pendingDecision && <section className={styles.nextAction} id="binding-decision" tabIndex={-1}>
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

      {formalGuidance && <section id="binding-formal" tabIndex={-1} className={`${styles.nextAction} ${styles.detailAnchor}`}>
        <h2>{request.status === "PENDING_FORMAL" ? pendingReviews > 0 ? "已进入待转正" : "已满足转正条件" : "转正发布条件"}</h2>
        {pendingReviews > 0 && <span className="small muted">还有 {pendingReviews} 条绑定电子流待审批，处理后可转正。</span>}
        {formalGuidance.href
          ? <Link href={formalGuidance.href} prefetch={false} className="button button-primary button-sm">前往转正发布 <ArrowRight size={12} aria-hidden="true" /></Link>
          : <GuidanceDialog label={formalGuidance.canManage ? "前往转正发布" : "查看转正条件"} title="转正发布条件"
            description={formalGuidance.description} items={formalGuidance.items}
            triggerClassName="button button-secondary button-sm" />}
      </section>}

      <div className={styles.detailColumns}>
        <div className={styles.stack}>
          <section id="binding-nodes" tabIndex={-1} className={`card ${styles.detailAnchor}`}>
            <div className="card-header"><h2 className={styles.tableHeading}>本项目节点绑定</h2><span className="small muted">{passed}/{requirements.length} 节点通过{waived > 0 ? ` · ${waived} 个节点免绑` : ""}</span></div>
            <div className="card-body" style={{ paddingTop: 12 }}>
              {requirements.length > 0 && <div style={{ marginBottom: 12 }}><ProgressBar value={passed + waived} max={requirements.length} /></div>}
              {requirements.length === 0 ? <EmptyState title="该版本没有节点绑定记录" /> : <div className={styles.nodeList}>
                {requirements.map((requirement) => {
                  const availability = bindingRequirementAvailability({
                    status: requirement.status,
                    pushed: requirement.pushedAt !== null,
                    waived: requirement.waivedAt !== null,
                  });
                  const acceptsBinding = canEditFlows && availability !== "CLOSED";
                  const open = canEditFlows && availability === "OPEN";
                  const showSubmit = acceptsBinding && canSubmitBindingFlow(user, requirement.bindingOwnerId);
                  const canSubmit = open && canSubmitBindingFlow(user, requirement.bindingOwnerId);
                  const showWaive = acceptsBinding && request.status === "TRIAL" && requirement.status === "PENDING"
                    && (manager || requirement.bindingOwnerId === user.id);
                  const { passShortfall, submissionShortfall: missing, canConfirm: meetsBarcodeRequirements } =
                    bindingBarcodeProgress(requirement.requiredCount, requirement);
                  const readyToConfirm = open && requirement.status === "PENDING" && meetsBarcodeRequirements;
                  const canConfirm = readyToConfirm && canConfirmNodes;
                  const showConfirm = acceptsBinding && requirement.status === "PENDING" && canConfirmNodes;
                  const pushGuidance = [{
                    title: "该节点的绑定任务尚未推送",
                    detail: "请先由软件经理决定绑定方式并推送任务。",
                    href: pendingDecision ? "#binding-decision" : undefined,
                    actionLabel: "查看绑定方式",
                  }];
                  const canReview = (flow: typeof requirement.flows[number]) => open && flow.status === "PENDING"
                    && bindingFlowApprovalBlocker(user, flow) === null;
                  const canWithdraw = (flow: typeof requirement.flows[number]) => (request.status === "VOID" || canEditFlows)
                    && isActiveBindingFlow(flow.status) && (flow.submittedById === user.id || canManageProjectWorkflowForProject(user, request.projectId));
                  const pendingFlows = requirement.flows.filter((flow) => flow.status === "PENDING");
                  const unreviewedFlows = requirement.flows.filter((flow) => flow.status === "APPROVED"
                    && flow.barcodeResults.some((barcode) => barcode.result === "UNREVIEWED"));
                  const failedFlows = requirement.flows.filter((flow) => isActiveBindingFlow(flow.status)).flatMap((flow) => {
                    const barcodes = flow.barcodeResults.filter((barcode) => barcode.result === "FAIL");
                    return barcodes.length > 0 ? [{ flow, barcodes }] : [];
                  });
                  const missingReasonId = failedFlows.flatMap(({ barcodes }) => barcodes).find((barcode) => !barcode.failureReason?.trim())?.id;
                  const qualificationHint = [
                    missing > 0 ? `由绑定责任人补充至少 ${missing} 个条码并提交电子流。` : undefined,
                    passShortfall > 0 && pendingFlows.length > 0 ? "由指定审批人处理待审批电子流。" : undefined,
                    requirement.unreviewedApprovedCount > 0 ? `还有 ${requirement.unreviewedApprovedCount} 个已审批条码待判定。` : undefined,
                  ].filter(Boolean).join("");
                  const confirmationFields = { ...actionFields, requirementId: requirement.id, evidenceKey: requirement.barcodeEvidenceKey };
                  const confirmGuidance: GuidanceItem[] = !requirement.pushedAt ? pushGuidance : [
                    ...(passShortfall > 0 ? [{
                      title: `还需 ${passShortfall} 个通过条码`,
                      detail: `当前 ${requirement.passedBarcodeCount}/${requirement.requiredCount}。只有电子流已审批且验证结果为 PASS 的条码计入。${qualificationHint}`,
                    }] : []),
                    ...unreviewedFlows.map((flow) => ({
                      title: `${flow.flowNo} · 条码待判定`,
                      href: `#binding-barcodes-${flow.id}`,
                      actionLabel: "判定设备条码",
                    })),
                    ...(passShortfall === 0 ? [] : pendingFlows.map((flow) => ({
                      title: `${flow.flowNo} · 待审批`,
                      href: `#binding-flow-${flow.id}`,
                      actionLabel: canReview(flow) ? "去审批" : "查看待审批电子流",
                    }))),
                  ];
                  const pendingOpen = canSubmit || showWaive || showConfirm || (open && canConfirmNodes && pendingFlows.length > 0)
                    || requirement.flows.some((flow) => canReview(flow) || canWithdraw(flow));
                  return (
                    <details className="binding-table-item binding-requirement" key={requirement.id} id={`binding-node-${requirement.id}`} open={pendingOpen} tabIndex={-1}>
                      <summary className={styles.nodeHeading}>
                        <span><strong>{requirement.nodeName}</strong> <span className="small muted">
                          {requirement.legacyConfirmation ? `${requirement.approvedCount}/${requirement.requiredCount} 条码已审批` : `${requirement.passedBarcodeCount}/${requirement.requiredCount} 条码通过`}
                          {requirement.unreviewedApprovedCount > 0 && !requirement.legacyConfirmation && ` · ${requirement.unreviewedApprovedCount} 待判定`}
                          {requirement.failedBarcodeCount > 0 && ` · ${requirement.failedBarcodeCount} FAIL`}
                        </span></span>
                        <span>{requirement.waivedAt ? <Badge tone="slate" dot>节点免绑</Badge>
                          : requirement.confirmedAt ? <Badge tone="emerald" dot>绑定通过</Badge>
                          : requirement.status === "CANCELLED" ? <Badge tone="slate" dot>{request.status === "VOID" ? "已关闭" : "已跳过"}</Badge>
                          : readyToConfirm ? <Badge tone="amber" dot>待确认</Badge>
                          : canEditFlows && (requirement.pushedAt
                            ? <Badge tone="amber" dot>{requirement.unreviewedApprovedCount > 0 ? "待判定"
                              : pendingFlows.length > 0 && missing === 0 ? "待审批" : "待绑定"}</Badge>
                            : <Badge tone="slate" dot>未推送</Badge>)}</span>
                        <ChevronDown size={16} aria-hidden="true" />
                      </summary>
                      <div className="binding-table-body">
                        <div className={styles.rowActions}>
                          <span className="small muted">绑定责任人 {requirement.bindingOwnerName ?? "未配置"}</span>
                          <span className="small muted">审批范围 {requirement.approverOptions.map((approver) => approver.userName).join("、") || "未配置"}</span>
                        </div>
                        {requirement.waivedAt && <p className="small muted" style={{ marginBottom: 8 }}>免绑原因：{requirement.decisionReason} · {requirement.waivedByName ?? "—"} · {formatDateTime(requirement.waivedAt)}</p>}
                        {requirement.confirmedAt && <p className="small muted">{requirement.confirmedByName ?? "—"} 确认通过 · {formatDateTime(requirement.confirmedAt)}{requirement.legacyConfirmation && " · 按原规则确认，未记录逐条结果"}</p>}
                        {open && requirement.status === "PENDING" && requirement.unreviewedApprovedCount > 0 && !canConfirmNodes &&
                          <p className="small muted">待软件包责任人、本项目软件经理或管理员判定条码。</p>}
                        {readyToConfirm && !canConfirmNodes && <p className="small muted">待软件包责任人、本项目软件经理或管理员确认。</p>}
                        {open && requirement.status === "PENDING" && !readyToConfirm && pendingFlows.length > 0 && qualificationHint &&
                          <p className="small muted">已提交 {requirement.submittedCount}/{requirement.requiredCount} 个条码。{qualificationHint}</p>}
                        {(showSubmit || showWaive || showConfirm) && <div className={styles.rowActions} style={{ marginTop: 10 }}>
                          {showConfirm && (open && failedFlows.length > 0 ? (
                            <FormDialog label="确认节点通过" title={`${requirement.nodeName} · 填写条码失败原因`}
                              description={canConfirm
                                ? `${requirement.passedBarcodeCount}/${requirement.requiredCount} 个条码通过。逐条补齐失败原因后确认。`
                                : `本次可保存失败原因。${passShortfall > 0 ? `还需 ${passShortfall} 个通过条码。` : ""}${qualificationHint}`}
                              triggerClassName={`button ${canConfirm ? "button-primary" : "button-secondary"} button-sm`} cancelLabel="取消">
                              <ActionForm action={confirmBindingRequirementAction} preserveValuesOnSubmit
                                hidden={{ ...confirmationFields, intent: canConfirm ? undefined : "save-reasons" }}
                                submitText={canConfirm ? "保存原因并确认通过" : "保存失败原因"}>
                                {failedFlows.map(({ flow, barcodes }) => (
                                  <fieldset className={barcodeStyles.reasonGroup} key={flow.id}>
                                    <legend className="mono">{flow.flowNo}</legend>
                                    {barcodes.map((barcode) => (
                                      <label className="field" key={barcode.id}>
                                        <span className="label"><span className="mono">{barcode.barcode}</span> 失败原因 <span className="required-mark" aria-hidden="true">*</span></span>
                                        <textarea className="textarea" name={`failureReason_${barcode.id}`} aria-label={`条码 ${barcode.barcode} 失败原因`}
                                          defaultValue={barcode.failureReason ?? ""} required maxLength={BINDING_BARCODE_FAILURE_REASON_LIMIT} rows={2} data-dialog-autofocus={barcode.id === missingReasonId || undefined} />
                                      </label>
                                    ))}
                                  </fieldset>
                                ))}
                              </ActionForm>
                            </FormDialog>
                          ) : canConfirm ? <ActionForm action={confirmBindingRequirementAction}
                            className="inline-action-form"
                            hidden={confirmationFields}
                            submitText="确认节点通过" submitClassName="button-sm"
                          /> : <GuidanceDialog label="确认节点通过" title={`${requirement.nodeName} · 节点通过条件`}
                            items={confirmGuidance} triggerClassName="button button-secondary button-sm" />)}
                          {showSubmit && (canSubmit ? <FormDialog key={requirement.flows.length} label="新增绑定电子流" title={`${requirement.nodeName} · 提交绑定电子流`} triggerClassName={`button ${canConfirm ? "button-secondary" : "button-primary"} button-sm`} cancelLabel="取消">
                            <BindingFlowForm requirementId={requirement.id} requestId={requestId} approvers={requirement.approverOptions} currentUserId={user.id}
                              scopeProjectId={scopeProjectId} listState={listState}
                              configurationHref={manager ? `/settings/projects/${request.projectId}/nodes/${requirement.nodeId}` : undefined} />
                          </FormDialog> : <GuidanceDialog label="新增绑定电子流" title={`${requirement.nodeName} · 绑定电子流提交条件`}
                            items={pushGuidance} triggerClassName="button button-secondary button-sm" />)}
                          {showWaive && (open ? <FormDialog label="节点无需绑定" title={`${requirement.nodeName} · 确认免绑`} description="只影响当前项目的这个节点。待审批电子流会关闭，已登记的记录会保留。" triggerClassName="button button-secondary button-sm" cancelLabel="取消">
                            <ActionForm action={waiveBindingRequirementAction} hidden={{ ...actionFields, requirementId: requirement.id }} submitText="确认节点免绑">
                              <label className="field"><span className="label">免绑原因 <span className="required-mark">*</span></span><textarea className="textarea" name="reason" required minLength={5} /></label>
                            </ActionForm>
                          </FormDialog> : <GuidanceDialog label="节点无需绑定" title={`${requirement.nodeName} · 节点免绑条件`}
                            items={pushGuidance} triggerClassName="button button-secondary button-sm" />)}
                        </div>}
                        <div className="binding-flow-list">
                          {requirement.flows.length === 0 ? (
                            <span className="small muted">暂无绑定电子流。</span>
                          ) : requirement.flows.map((flow) => {
                            const meta = BINDING_FLOW_STATUS_META[flow.status as BindingFlowStatus];
                            const canApprove = canReview(flow);
                            const canCancel = canWithdraw(flow);
                            const canMarkBarcodes = open && canConfirmNodes && (flow.status === "PENDING" || (showConfirm && flow.status === "APPROVED"));
                            return (
                              <div className={`binding-flow-row ${styles.detailAnchor}`} key={flow.id} id={`binding-flow-${flow.id}`} tabIndex={-1}>
                                <div className="toolbar" style={{ gap: 7, flexWrap: "wrap" }}>
                                  <Link2 size={13} style={{ color: "var(--muted-light)" }} />
                                  <span className="mono" style={{ fontSize: 11, fontWeight: 600 }}>{flow.flowNo}</span>
                                  <Badge tone={meta?.tone ?? "slate"}>{meta?.label ?? flow.status}</Badge>
                                  {flow.webUrl && <ExternalLink href={flow.webUrl} className="flow-web-link">网页电子流</ExternalLink>}
                                </div>
                                {flow.barcodeResults.length > 0 && (
                                  <details className={`barcode-details ${barcodeStyles.flowDetails} ${styles.detailAnchor}`} id={`binding-barcodes-${flow.id}`} tabIndex={-1}>
                                    <summary>设备条码 {flow.barcodeResults.length} 个</summary>
                                    {canMarkBarcodes ? (
                                      <BindingBarcodeEditor key={flow.barcodeResults.map(({ id, result }) => `${id}:${result}`).join(",")} barcodes={flow.barcodeResults}
                                        hidden={{ ...confirmationFields, flowId: flow.id }}>
                                        <BindingBarcodeList barcodes={flow.barcodeResults} editable />
                                      </BindingBarcodeEditor>
                                    ) : <>
                                      <BindingBarcodeList barcodes={flow.barcodeResults} />
                                      {open && isActiveBindingFlow(flow.status) && <p className="small muted">
                                        {requirement.status === "PASSED" && flow.status === "APPROVED"
                                          ? "节点已确认，已审批的条码结果已锁定。"
                                          : "由软件包责任人、本项目软件经理或管理员判定。"}
                                      </p>}
                                    </>}
                                  </details>
                                )}
                                <div className="small muted" style={{ marginTop: 4 }}>
                                  {flow.submittedByName ?? "—"} 提交 · 指定审批人 {flow.approverName ?? "—"} · {formatDateTime(flow.submittedAt)}
                                  {flow.reviewedByName && <> · 实际审批人 {flow.reviewedByName}</>}
                                  {flow.reviewComment ? ` · ${flow.reviewComment}` : ""}
                                </div>
                                {flow.cancelReason && <p className="small muted">撤销原因：{flow.cancelReason}</p>}
                                {(canApprove || canCancel || (open && flow.status === "PENDING")) && (
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
                                    {!canApprove && open && flow.status === "PENDING" && (
                                      <GuidanceDialog label="查看审批条件" title={`审批 ${flow.flowNo} 的条件`}
                                        items={[{ title: flow.submittedById === user.id ? "提交人不能审批自己的电子流" : "由指定审批人或管理员审批",
                                          detail: `指定审批人：${flow.approverName ?? "未配置"}。` }]}
                                        triggerClassName="button button-secondary button-sm" />
                                    )}
                                    {canCancel && (
                                      <FormDialog label="撤销电子流" title={`撤销 ${flow.flowNo}`}
                                        description={flow.status === "APPROVED" && canEditFlows
                                          ? "请先在原网页撤销电子流。登记后，这些条码不再计入有效数量，已确认的节点需要重新确认。"
                                          : "请先在原网页撤销电子流。登记后，本条电子流将标记为已撤销。"}
                                        triggerClassName="button button-ghost button-sm" cancelLabel="取消">
                                        <ActionForm action={cancelBindingFlowAction} hidden={{ ...actionFields, flowId: flow.id }} submitText="确认撤销电子流" submitVariant="danger" submitClassName="button-sm">
                                          <label className="field"><span className="label">撤销原因 <span className="required-mark" aria-hidden="true">*</span></span>
                                            <textarea className="textarea" name="reason" required minLength={5} maxLength={2000} />
                                          </label>
                                        </ActionForm>
                                      </FormDialog>
                                    )}
                                  </div>
                                )}
                                {request.status === "VOID" && isActiveBindingFlow(flow.status) && flow.submittedById === user.id && (
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
              {batch && <div className="detail-row"><dt>转测批次</dt><dd><Link href={workflowHref(`/integration/${batch.batchId}`, scopeProjectId === undefined ? undefined : batch.batchProjectId)} prefetch={false} className="archive-link">{batch.batchCode} · {batchConclusion?.label ?? "待提交结论"}</Link></dd></div>}
              {request.status === "VOID" && request.riskConclusion && <div className="detail-row"><dt>风险结论</dt><dd>{request.riskConclusion}</dd></div>}
              <div className="detail-row"><dt>归档地址</dt><dd><ExternalLink href={request.archiveUrl}>下载归档</ExternalLink></dd></div>
            </dl>
            <hr className="divider" style={{ margin: "12px 0" }} />
            <p className="note">{request.changeSummary}</p>
          </div></section>

          {request.trialReviewMinutes && (
            <section className="card" aria-labelledby="trial-review-minutes-heading">
              <div className="card-header"><h2 className={styles.tableHeading} id="trial-review-minutes-heading">试制评审纪要</h2></div>
              <div className="card-body"><p className={styles.reviewMinutesText}>{request.trialReviewMinutes}</p></div>
            </section>
          )}

          {request.status !== "VOID" && request.bindingMode === "SKIPPED" && (
            <section className="card"><div className="card-body"><h2 className={styles.tableHeading}>整版免绑</h2><p className="note" style={{ marginTop: 6 }}>{request.bindingReason ?? "未记录免绑原因"}</p></div></section>
          )}

        </aside>
      </div>
    </>
  );
}
