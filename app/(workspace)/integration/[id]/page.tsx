import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ClipboardCheck, FileText } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { batchSelectionKey, DRAFT_CREATED_MESSAGE, draftRequestListState } from "@/lib/batch-preparation";
import { canManageProjectWorkflowForProject, canSubmitIntegrationConclusionForProject } from "@/lib/access";
import { parseFlash } from "@/lib/queries";
import { requireWorkflowProject } from "@/lib/project-scope";
import { workflowHref } from "@/lib/workflow-links";
import { getWorkflowListState } from "@/lib/workflow-list";
import { integrationHistoryParams, readIntegrationHistory } from "@/lib/integration-history";
import { getRiskTrialEntries } from "@/lib/trial-risk-entry";
import { RiskTrialEntryAction } from "@/components/risk-trial-entry-action";
import { getBatchDetail, getWorkflowProjectScope, type BatchItemRow } from "@/lib/workflow-queries";
import { getBatchSendCheck } from "@/lib/batch-send-check";
import { getTrialReleaseGuidance } from "@/lib/release-guidance";
import { all } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { ATTRIBUTION_META, CONCLUSION_META } from "@/lib/constants";
import { addBatchProgressAction, completeBatchAction, deleteDraftBatchAction, sendBatchAction, terminateBatchAction } from "@/lib/actions/workflow";
import { ActionForm } from "@/components/action-form";
import { BatchConclusionFields, BatchReportField } from "@/components/batch-conclusion-fields";
import { ClearBatchChoices } from "@/components/pending-batch-choices";
import { FormDialog } from "@/components/form-dialog";
import { GuidanceDialog } from "@/components/guidance-dialog";
import { InfoTooltip } from "@/components/info-tooltip";
import { Badge, BatchStatusPill, ExternalLink, FlashMessage, PageHeader } from "@/components/ui";
import styles from "@/components/workflow-queue.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "转测批次详情" };

export default async function BatchDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const batchId = Number(id);
  if (!Number.isInteger(batchId)) notFound();
  const scope = getWorkflowProjectScope(user, true);
  const data = getBatchDetail(batchId, scope);
  if (!data) notFound();
  const search = await searchParams;
  const notice = parseFlash(search.flash, search.tone === "error" ? "error" : "success");
  const { batch, items, progressNotes } = data;
  const project = requireWorkflowProject(user, search.project, batch.projectId);
  const listState = getWorkflowListState(search);
  const manager = canManageProjectWorkflowForProject(user, batch.projectId);
  const archived = batch.projectStatus === "ARCHIVED";
  const canManage = !archived && manager;
  const isDraft = batch.status === "DRAFT";
  const isActive = batch.status === "IN_TEST";
  const canTest = isActive && !archived && canSubmitIntegrationConclusionForProject(user, batch.projectId);
  if (isDraft && !manager) notFound();
  const requestListState = isDraft && !archived ? draftRequestListState(search) : {};
  const fromRequests = requestListState.fromRequests === "1";
  const batchFormFields = { batchId: batch.id, scopeProjectId: project?.id, ...listState, ...requestListState };
  const returnPath = isDraft && !archived ? "/submissions" : "/integration";
  const returnView = archived ? "history" : isDraft ? fromRequests ? undefined : "drafts" : isActive ? undefined : "history";
  const returnLabel = fromRequests ? "返回待安排申请" : returnView === "drafts" ? "返回待发起批次" : returnView === "history" ? "返回历史批次" : "返回在测批次";
  const showSecondary = (canManage && (isDraft || isActive)) || batch.status === "COMPLETED" || batch.status === "TERMINATED";
  const changedItems = items.filter((item) => item.isChanged);
  const riskStage = batch.status === "IN_TEST" ? "IN_TEST"
    : batch.status === "COMPLETED" && batch.conclusion === "FAIL" ? "FAILED"
    : batch.status === "COMPLETED" && batch.conclusion === "BLOCKED" ? "BLOCKED"
    : null;
  const riskEntries = getRiskTrialEntries(canManage && riskStage ? changedItems.flatMap((item) =>
    item.transferRequestId && item.requestStatus === riskStage ? [item.transferRequestId] : [],
  ) : []);
  const showRisk = Object.keys(riskEntries).length > 0;
  const showContinuation = !archived && (batch.status === "COMPLETED" || batch.status === "TERMINATED");
  const trialGuidance = new Map(showContinuation
    ? changedItems.filter(({ requestStatus }) => requestStatus === "PASSED")
      .map(({ versionId }) => [versionId, getTrialReleaseGuidance(user, versionId, { projectId: batch.projectId, returnTo: listState.returnTo })])
    : []);
  const reportContacts = isActive && !archived && !canTest ? all<{ name: string }>(
    `SELECT DISTINCT u.name FROM users u
     WHERE u.is_active = 1 AND (
       EXISTS (SELECT 1 FROM area_project_leads l JOIN areas a ON a.id = l.area_id AND a.is_integration = 1
         WHERE l.project_id = ? AND l.user_id = u.id)
       OR EXISTS (SELECT 1 FROM area_leaders l JOIN areas a ON a.id = l.area_id AND a.is_integration = 1
         WHERE l.user_id = u.id)
     ) ORDER BY u.name`, batch.projectId,
  ).map(({ name }) => name) : [];
  const draftBlockers = isDraft && canManage ? getBatchSendCheck(batch.id).blockers : [];
  const editHref = workflowHref("/submissions/batch/new", batch.projectId, { ...listState, ...requestListState, draft: batch.id, from: project ? undefined : "all" });

  const historyState = readIntegrationHistory(search);
  const backToList = workflowHref(returnPath, project?.id ?? (archived ? batch.projectId : undefined), {
    ...listState,
    request: requestListState.request,
    ...(returnView === "history" ? integrationHistoryParams(historyState) : {}),
    view: returnView,
  }) + (returnView === "history" ? "#integration-history" : "");

  function nextStep(item: BatchItemRow) {
    if (!item.isChanged) return <span className="small muted">配套基线，本轮结论不更新该版本</span>;
    const context = { returnTo: listState.returnTo };
    const traceHref = workflowHref(`/versions/${item.versionId}`, project?.id, context);
    if (item.versionStatus === "VOID" || item.requestStatus === "VOID") return <Link href={traceHref} prefetch={false} className="archive-link">查看作废记录</Link>;
    if (item.versionStatus === "FORMAL") return <Link href={traceHref} prefetch={false} className="archive-link">查看转正记录</Link>;
    const queueProject = batch.projectId && (scope === null || scope.includes(batch.projectId)) ? batch.projectId : undefined;
    if (item.requestStatus === "PENDING" && item.transferRequestId) {
      return queueProject ? <Link href={workflowHref("/submissions", queueProject, { ...context, request: item.transferRequestId })}
        prefetch={false} className="archive-link">查看待安排申请</Link> : <span className="small muted">请联系该项目的软件经理安排转测。</span>;
    }
    if (item.requestStatus === "IN_TEST" && item.activeBatchId) {
      return <Link href={workflowHref(`/integration/${item.activeBatchId}`, queueProject, context)}
        prefetch={false} className="archive-link">查看当前在测批次</Link>;
    }
    if (item.versionStatus === "TRIAL" || item.versionStatus === "PENDING_FORMAL") {
      return <Link href={traceHref} prefetch={false} className="archive-link">{item.versionStatus === "TRIAL" ? "查看试制与绑定进度" : "核对转正进度"}</Link>;
    }
    const trial = trialGuidance.get(item.versionId);
    if (trial?.href && !trial.items.length) return <Link href={trial.href} prefetch={false} className="archive-link">
      {trial.canManage ? "查看发布试制" : "查看试制进度"}</Link>;
    if (trial?.items.length) return <GuidanceDialog label="检查试制条件" title={`${item.packageName} ${item.version} · 试制条件`} description={trial.description}
      items={trial.items} fallbackHref={traceHref} triggerClassName="button button-secondary button-sm" />;
    if (item.requestStatus === "FAILED" || item.requestStatus === "BLOCKED") {
      return <Link href={workflowHref("/submissions/transfer", queueProject, { ...context, package: item.packageId })}
        prefetch={false} className="archive-link">查看新版本提交条件</Link>;
    }
    return <Link href={traceHref} prefetch={false} className="archive-link">查看版本进度</Link>;
  }

  return (
    <>
      {isDraft && notice?.message === DRAFT_CREATED_MESSAGE && <ClearBatchChoices selectionKey={batchSelectionKey(user.id, batch.projectId)} batchId={batch.id} />}
      <PageHeader
        title={`${batch.code} · ${batch.title}`}
        description={<>{batch.projectName ?? "未指定项目"} · {batch.itemCount} 个软件包 · {batch.changedCount} 个变更 · {isDraft ? "创建于" : "发起于"}{formatDateTime(batch.sentAt ?? batch.createdAt)}</>}
        actions={<>
          <Link href={backToList} prefetch={false} className="button button-secondary"><ArrowLeft size={14} />{returnLabel}</Link>
          {canTest && <FormDialog label={<><ClipboardCheck size={16} aria-hidden="true" />提交测试结论</>} title={`${batch.code} · 提交项目测试结论`} description={batch.projectName ?? undefined} cancelLabel="取消">
            <ActionForm action={completeBatchAction} testId="complete-test-form" hidden={batchFormFields} submitText="提交验证结论" preserveValuesOnSubmit>
              <div className={styles.formFields}>
                <BatchConclusionFields items={items.map(({ versionId, packageName, version, parallelRiskTrial }) => ({ versionId, packageName, version, parallelRiskTrial }))} />
                <label className="field"><span className="label">测试总结</span><textarea className="textarea" name="testSummary" required minLength={10} placeholder="验证范围、结果及问题定位" /></label>
                <BatchReportField />
              </div>
            </ActionForm>
          </FormDialog>}
          <BatchStatusPill status={batch.status as "DRAFT" | "IN_TEST" | "COMPLETED" | "TERMINATED"} />
        </>}
      />
      <FlashMessage notice={notice} />

      {isActive && !archived && !canTest && <section className={styles.nextAction}>
        <div><h2>等待测试结论</h2><p>{reportContacts.length > 0
          ? `可由本项目集成测试负责人或主管提交：${reportContacts.join("、")}。`
          : "请联系管理员在集成测试责任田分配本项目负责人。管理员也可提交结论。"}</p></div>
        <a className="button button-secondary button-sm" href="#progress">查看测试进展</a>
      </section>}

      <div className={showSecondary ? styles.detailColumns : styles.stack}>
        <div className={styles.stack}>
          <section className="card">
            <div className="card-header">
              <div className={styles.rowActions}>
                <h2 className={styles.tableHeading}>配套版本快照</h2>
                <InfoTooltip label="测试结论生效范围">本次测试结论同步到标记为“本轮变更”的软件包版本。</InfoTooltip>
              </div>
            </div>
            <div className="card-body" style={{ padding: 0, marginTop: 13 }}>
              <div className={`table-wrap ${styles.queueTable}`} role="region" aria-label="配套版本快照表格" tabIndex={0}>
                <table className="data-table">
                  <thead><tr><th>软件包</th><th>正式版本</th><th>试制版本</th><th>上次转测</th><th>本次转测</th><th>归档地址</th><th>变更</th>{showRisk && <th scope="col">风险试制</th>}{showContinuation && <th scope="col">下一步</th>}</tr></thead>
                  <tbody>
                    {items.map((item) => {
                      const entry = item.transferRequestId ? riskEntries[item.transferRequestId] : undefined;
                      const riskEntry = entry?.stage === riskStage && entry.batchId === batch.id ? entry : undefined;
                      return <tr key={item.id}>
                        <td><Link href={workflowHref("/packages", project?.id, { open: item.packageId })} prefetch={false} className={styles.packageName} style={{ fontWeight: 600 }}>{item.packageName}</Link><div className={`small muted ${styles.packageName}`}>{item.packageCode} · {item.ownerName ?? "责任人待定"}</div></td>
                        <td><span className="mono small">{item.formalVersion ?? "—"}</span></td>
                        <td><span className="mono small">{item.trialVersions || "—"}</span></td>
                        <td><span className="mono small">{item.previousTestVersion ?? "首次"}</span></td>
                        <td><Link href={workflowHref(`/versions/${item.versionId}`, project?.id)} prefetch={false} className="version-badge" aria-label={`查看 ${item.packageName} ${item.version} 版本全链路`}>{item.version}</Link>{item.requestStatus === "VOID" && <div><Badge tone="rose">已作废</Badge></div>}{item.isChanged && <div><Badge tone="amber">本轮变更</Badge></div>}</td>
                        <td><ExternalLink href={item.archiveUrl}>归档包</ExternalLink></td>
                        <td>
                          {!item.previousTestVersion ? <Badge tone="slate">首次转测</Badge> : item.changedVsPrevious ? <Badge tone="violet">有变更</Badge> : <Badge tone="slate">无变化</Badge>}
                          {item.parallelRiskTrial && <div><Badge tone="amber">并行风险试制</Badge></div>}
                          {item.issueAffected && <div><Badge tone="rose">涉及测试问题</Badge></div>}
                        </td>
                        {showRisk && <td className="cell-actions">{riskEntry && <RiskTrialEntryAction entry={riskEntry} packageName={item.packageName} packageCode={item.packageCode} version={item.version} projectName={batch.projectName ?? "未指定项目"} returnTo={listState.returnTo} />}</td>}
                        {showContinuation && <td>{nextStep(item)}</td>}
                      </tr>;
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>


          {!isDraft && <section className="card" id="progress">
            <div className="card-header">
              <h2 className={styles.tableHeading}>集成测试进展 <Badge tone="slate">{progressNotes.length} 条</Badge></h2>
              {canTest && <FormDialog key={progressNotes[0]?.id ?? "empty"} label="记录进展" title={`${batch.code} · 记录测试进展`} triggerClassName="button button-secondary button-sm" cancelLabel="取消">
                <ActionForm action={addBatchProgressAction} testId="add-batch-progress-form" hidden={batchFormFields} submitText="提交进展说明" submitClassName="button-sm">
                  <label className="field"><span className="label">进展说明</span><textarea className="textarea" name="content" required minLength={2} /></label>
                </ActionForm>
              </FormDialog>}
            </div>
            <div className="card-body" style={{ paddingTop: 12 }}>
              <div className="timeline">
                {progressNotes.map((note) => (
                  <div className="timeline-item" key={note.id}><span className="timeline-line" /><span className="timeline-dot" /><div><div className="timeline-title">{note.content}</div><div className="timeline-meta">{note.authorName ?? "未知"} · {formatDateTime(note.createdAt)}</div></div></div>
                ))}
                {progressNotes.length === 0 && <p className="muted small">暂无进展说明。</p>}
              </div>
            </div>
          </section>}
        </div>

        {showSecondary && <aside className={styles.stack} aria-label="批次处理">
          {isDraft && canManage && (
            <section className="card" aria-label="草稿操作">
              <div className={`card-body ${styles.cardActions}`}>
                {draftBlockers.length > 0 ? <GuidanceDialog label="发起转测" title={`${batch.code} · 发起转测条件`} fallbackHref={editHref}
                  items={draftBlockers.map(({ message, batchId: other }) => ({ title: message,
                    href: other ? workflowHref(`/integration/${other}`, batch.projectId, { returnTo: listState.returnTo }) : editHref,
                    actionLabel: other ? "查看占用批次" : "调整配套" }))}
                  triggerClassName="button button-secondary button-sm" />
                  : <ActionForm action={sendBatchAction} hidden={batchFormFields} submitText="发起转测" submitClassName="button-sm" className="inline-action-form" confirmMessage={`发起 ${batch.code} 后，${batch.projectName ?? "该项目"}的测试负责人会收到待测批次。`} />}
                <Link href={editHref} prefetch={false} className="button button-secondary button-sm">调整配套</Link>
                <FormDialog label="删除草稿" title={`删除 ${batch.code} 草稿`} description="草稿将被删除，本批次占用的版本会退回待安排申请。" triggerClassName="button button-ghost button-sm" cancelLabel="取消">
                  <ActionForm action={deleteDraftBatchAction} hidden={batchFormFields} submitText="删除草稿" submitVariant="outline-danger" submitClassName="button-sm" />
                </FormDialog>
              </div>
            </section>
          )}

          {isActive && canManage && (
            <section className="card" aria-label="测试批次操作"><div className="card-body">
              <FormDialog label="终止测试" title={`终止 ${batch.code} 集成测试`} description="终止后，本批次变更版本在当前项目下退回待转测。" triggerClassName="button button-outline-danger button-sm" cancelLabel="取消">
                <ActionForm action={terminateBatchAction} testId="terminate-batch-form" hidden={batchFormFields} submitText="确认终止测试" submitVariant="danger">
                  <label className="field"><span className="label">终止原因</span><textarea className="textarea" name="reason" required minLength={4} /></label>
                </ActionForm>
              </FormDialog>
            </div></section>
          )}

          {batch.status === "COMPLETED" && (
            <section className="card">
              <div className="card-header"><h2 className={styles.tableHeading}>验证结论</h2>{batch.conclusion && <Badge tone={CONCLUSION_META[batch.conclusion as keyof typeof CONCLUSION_META]?.tone ?? "slate"}>{CONCLUSION_META[batch.conclusion as keyof typeof CONCLUSION_META]?.label ?? batch.conclusion}</Badge>}</div>
              <div className="card-body" style={{ paddingTop: 14 }}>
                {batch.issueAttribution && <Badge tone={ATTRIBUTION_META[batch.issueAttribution as keyof typeof ATTRIBUTION_META]?.tone ?? "slate"}>{ATTRIBUTION_META[batch.issueAttribution as keyof typeof ATTRIBUTION_META]?.label ?? batch.issueAttribution}</Badge>}
                <p className="change-copy" style={{ marginTop: 12 }}>{batch.testSummary}</p>
                {batch.testReportUrl && <div style={{ marginTop: 12 }}><ExternalLink href={batch.testReportUrl}><FileText size={12} /> {batch.testReportName ?? "测试验证报告"}</ExternalLink></div>}
              </div>
            </section>
          )}

          {batch.status === "TERMINATED" && (
            <section className="card"><div className="card-header"><h2 className={styles.tableHeading}>测试已终止</h2></div><div className="card-body" style={{ paddingTop: 12 }}><dl className="detail-row"><dt>终止时间</dt><dd>{formatDateTime(batch.terminatedAt)}</dd></dl><div className="risk-callout" data-tone="danger" style={{ marginTop: 12 }}>{batch.terminateReason ?? "未填写终止原因"}</div></div></section>
          )}

        </aside>}
      </div>
    </>
  );
}
