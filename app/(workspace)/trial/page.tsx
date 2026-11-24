import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { FormDialog } from "@/components/form-dialog";
import { ReleaseFlowEvidence } from "@/components/release-flow-evidence";
import { TrialQueueTable, type TrialTableColumn } from "@/components/trial-queue-table";
import { Badge, ExternalLink, FlashMessage, PageHeader } from "@/components/ui";
import styles from "@/components/trial-queue-table.module.css";
import { WorkflowQueueNav } from "@/components/workflow-queue-nav";
import { WorkflowPackageName } from "@/components/workflow-package-name";
import { VersionVoidDialog } from "@/components/version-void-dialog";
import { CONCLUSION_META, TRANSFER_REQUEST_STATUS_META, type BatchConclusion, type TransferRequestStatus } from "@/lib/constants";
import { getWorkflowListState } from "@/lib/workflow-list";
import { canManageProjectWorkflowForProject } from "@/lib/access";
import { abandonTrialReleaseAction, releaseTrialAction } from "@/lib/actions/workflow";
import { requireUser } from "@/lib/auth";
import { packageIdentity } from "@/lib/package-identity";
import { requireWorkflowProject } from "@/lib/project-scope";
import { parseFlash } from "@/lib/queries";
import { trialBindingStatuses, trialQueueKey, trialQueueParams, trialReleaseStatuses, type TrialSearchParams } from "@/lib/trial-queue";
import { trialReleaseStateKey } from "@/lib/trial-release-state";
import { workflowHref } from "@/lib/workflow-links";
import { getTrialReadyVersions, getTrialVersions, getWorkflowProjectScope, type TrialReadyVersion, type TrialVersionRow } from "@/lib/workflow-queries";
import workflowStyles from "@/components/workflow-queue.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "试制与绑定验证" };

function riskRelease(row: TrialReadyVersion) {
  return row.riskProjectCount > 0;
}

function readyStatus(row: TrialReadyVersion) {
  return trialReleaseStatuses[riskRelease(row) ? "RISK" : "READY"];
}

function bindingStatusOptions(row: TrialVersionRow) {
  const statuses: Array<keyof typeof trialBindingStatuses> = [row.bindingMode];
  if (row.releaseMode === "RISK" || !row.batchId) statuses.push("RISK");
  if (row.isOverdue) statuses.push("OVERDUE");
  return statuses.map((value) => ({ value, label: trialBindingStatuses[value] }));
}

function batchLink(row: TrialReadyVersion | TrialVersionRow, projectId?: number) {
  if (!row.batchId) return <span className="small muted">未关联转测批次</span>;
  return <Link href={workflowHref("/integration/" + row.batchId, projectId)} className="archive-link" prefetch={false}>
    {row.batchCode ? <span className="mono">{row.batchCode}</span> : "查看批次"}
  </Link>;
}

export default async function TrialPage({ searchParams }: { searchParams: Promise<TrialSearchParams> }) {
  const user = await requireUser();
  const params = await searchParams;
  const notice = parseFlash(params.flash, params.tone === "error" ? "error" : "success");
  const project = requireWorkflowProject(user, params.project);
  const projectId = project?.id;
  const scope = project ? [project.id] : getWorkflowProjectScope(user);
  const archived = project?.status === "ARCHIVED";
  const canViewReleaseQueue = !archived && (project ? canManageProjectWorkflowForProject(user, project.id) : user.role === "ADMIN" || user.role === "SOFTWARE_MANAGER");
  const showBindings = !canViewReleaseQueue || params.view === "binding";
  const currentKind = showBindings ? "binding" : "release";
  const queueParams = trialQueueParams({
    ...params,
    [trialQueueKey(currentKind, "q")]: params[trialQueueKey(currentKind, "q")] ?? params.q,
    [trialQueueKey(currentKind, "page")]: params[trialQueueKey(currentKind, "page")] ?? params.page,
    [trialQueueKey(currentKind, "size")]: params[trialQueueKey(currentKind, "size")] ?? params.pageSize,
  });
  const { returnTo } = getWorkflowListState(params);
  const query = { ...queueParams, ...(returnTo ? { returnTo } : {}), ...(showBindings ? { view: "binding" } : {}) };
  const queueHref = (binding: boolean) => workflowHref("/trial", projectId, { ...query, view: binding ? "binding" : undefined }) + (binding ? "#binding-queue" : "");
  const byVersion = new Map<number, TrialReadyVersion[]>();
  if (canViewReleaseQueue) {
    for (const request of getTrialReadyVersions(scope)) {
      const records = byVersion.get(request.versionId);
      if (records) records.push(request);
      else byVersion.set(request.versionId, [request]);
    }
  }
  const ready = [...byVersion.values()].map((records) => ({
    ...(records.find((row) => canManageProjectWorkflowForProject(user, row.projectId)) ?? records[0]),
    records,
  })).sort((first, second) => Number(riskRelease(first)) - Number(riskRelease(second)));
  const trials = getTrialVersions(scope).sort((first, second) => second.isOverdue - first.isOverdue || second.pendingFlowCount - first.pendingFlowCount);
  const canRelease = (row: TrialReadyVersion) => canManageProjectWorkflowForProject(user, row.projectId);
  const packageLink = (row: TrialReadyVersion | TrialVersionRow) => (
    <Link href={workflowHref("/packages", projectId, { open: row.packageId })} prefetch={false} className={`archive-link ${workflowStyles.packageName}`}>{row.packageName}</Link>
  );

  const identityColumns: TrialTableColumn<TrialReadyVersion | TrialVersionRow>[] = [
    { key: "package", label: "软件包", value: (row) => row.packageName, cell: packageLink },
    { key: "version", label: "版本", value: (row) => row.version, cell: (row) => <span className={`mono ${styles.version}`}>{row.version}</span> },
    { key: "project", label: "项目", value: (row) => row.projectName, choices: (row) => [{ value: String(row.projectId), label: row.projectName }] },
    {
      key: "batch",
      label: "转测批次",
      value: (row) => row.batchCode ?? "未关联转测批次",
      cell: (row) => batchLink(row, projectId),
    },
    { key: "submitter", label: "提交人", value: (row) => row.submittedByName ?? "未知" },
  ];
  const releaseColumns: TrialTableColumn<(typeof ready)[number]>[] = [
    ...identityColumns.slice(0, 2),
    {
      key: "project",
      label: "项目",
      value: (row) => row.records.map((record) => record.projectName).join("、"),
      choices: (row) => row.records.map((record) => ({ value: String(record.projectId), label: record.projectName })),
      cell: (row) => <><span>{row.records.map((record) => record.projectName).join("、")}</span>{row.versionProjectCount > row.records.length && <div className="small muted">共 {row.versionProjectCount} 个使用项目</div>}</>,
    },
    {
      key: "batch",
      label: "转测批次",
      value: (row) => row.records.map((record) => record.batchCode ?? "未关联转测批次").join("、"),
      filterValues: (row) => row.records.map((record) => record.batchCode ?? "未关联转测批次"),
      cell: (row) => <div className={styles.bindingStatus}>{row.records.map((record) => <span key={record.requestId}>{batchLink(record, record.projectId)}</span>)}</div>,
    },
    identityColumns[4],
    {
      key: "status",
      label: "发布状态",
      value: readyStatus,
      choices: (row) => [{ value: riskRelease(row) ? "RISK" : "READY", label: readyStatus(row) }],
      cell: (row) => <>
        <Badge tone={riskRelease(row) ? "amber" : "emerald"} dot>{readyStatus(row)}</Badge>
        {row.riskProjectCount > 0 && <div className="small muted">{row.riskProjectCount} 个项目有风险</div>}
        {row.ongoingTestCount > 0 && <div className="small muted">{row.ongoingTestCount} 个待发起或在测批次</div>}
      </>,
    },
  ];
  const bindingColumns: TrialTableColumn<TrialVersionRow>[] = [
    ...identityColumns,
    {
      key: "status",
      label: "绑定状态",
      value: (row) => bindingStatusOptions(row).map((option) => option.label).join(" · "),
      choices: bindingStatusOptions,
      cell: (row) => <div className={styles.bindingStatus}>
        <span>{trialBindingStatuses[row.bindingMode]}</span>
        {(row.releaseMode === "RISK" || !row.batchId) && <Badge tone="amber">风险发布</Badge>}
        {Boolean(row.isOverdue) && <Badge tone="rose">已超期</Badge>}
      </div>,
    },
    {
      key: "form",
      label: "试制电子流",
      value: (row) => row.trialFormNo ?? "—",
      cell: (row) => <ReleaseFlowEvidence value={row.trialFormNo} label="查看试制电子流" />,
    },
    {
      key: "progress",
      label: "完成节点",
      value: (row) => `${row.requirementPassed + row.requirementWaived} / ${row.requirementTotal}`,
      sortValue: (row) => row.requirementTotal > 0 ? (row.requirementPassed + row.requirementWaived) / row.requirementTotal : -1,
      cell: (row) => <div>{row.requirementPassed + row.requirementWaived} / {row.requirementTotal}
        {row.requirementWaived > 0 && <div className="small muted">含 {row.requirementWaived} 个免绑</div>}
      </div>,
    },
    { key: "pending", label: "待审批", value: (row) => row.pendingFlowCount },
  ];

  return (
    <>
      <PageHeader title="试制与绑定验证"
        description={archived ? "项目已归档" : undefined}
        actions={<Link href={workflowHref(archived ? "/versions" : "/formal", projectId, { returnTo })} className="button button-secondary" prefetch={false}>{archived ? "查看版本全链路" : "查看待转正版本"} <ArrowRight size={14} aria-hidden="true" /></Link>} />
      <FlashMessage notice={notice} />

      {canViewReleaseQueue && <WorkflowQueueNav label="试制与绑定队列" views={[
        { label: "待发布试制", href: queueHref(false), count: ready.length, current: !showBindings },
        { label: "节点绑定", href: queueHref(true), count: trials.length, current: showBindings, nativeNavigation: !showBindings },
      ]} />}

      {!showBindings && <TrialQueueTable
        kind="release" title="待发布试制" rows={ready} columns={releaseColumns} query={query} projectId={projectId}
        rowKey={(row) => row.versionId} details={(row) => [row.packageCode, ...row.records.map((record) => record.projectCode)]}
        emptyTitle="没有待发试制的项目版本"
        actions={(row) => {
          const risk = riskRelease(row);
          const identity = packageIdentity({ name: row.packageName, code: row.packageCode });
          const title = `${identity.code} ${row.version}`;
          const releaseFields = { ...query, requestId: row.requestId, scopeProjectId: projectId, eligibility: trialReleaseStateKey(row) };
          return (
            <div className={styles.actions}>
              {canRelease(row) && <>
                <FormDialog label="发布" title={"发布 " + title + " 试制"}
                  description={"发布后同步到全部 " + row.versionProjectCount + " 个使用项目。"}
                  triggerClassName="button button-secondary button-sm" cancelLabel="取消">
                  <WorkflowPackageName {...identity} />
                  <section aria-label="验收依据">
                    <h3>验收依据</h3>
                    {row.records.map((record) => {
                      const conclusion = record.batchConclusion ? CONCLUSION_META[record.batchConclusion as BatchConclusion] : null;
                      const status = TRANSFER_REQUEST_STATUS_META[record.integrationStatus as TransferRequestStatus];
                      return <div className="trial-source-line" key={record.requestId}>
                        <strong>{record.projectName}</strong>
                        <Badge tone={conclusion?.tone ?? status?.tone ?? "slate"}>{conclusion?.label ?? status?.label ?? "待验收"}</Badge>
                        {batchLink(record, record.projectId)}
                        {record.batchReportUrl && <ExternalLink href={record.batchReportUrl}>验证报告</ExternalLink>}
                        {record.batchTestSummary && <span className="small muted trial-summary">{record.batchTestSummary}</span>}
                      </div>;
                    })}
                    <div className={styles.actions}>
                      <ExternalLink href={row.archiveUrl}>归档包</ExternalLink>
                      {row.versionProjectCount > row.records.length && <Link href={workflowHref(`/versions/${row.versionId}`, undefined, { returnTo })} className="archive-link" prefetch={false}>全部项目证据</Link>}
                    </div>
                    {row.ongoingTestCount > 0 && <p className="note">已有 {row.ongoingTestCount} 个待发起或在测批次，完成前无法转正。</p>}
                  </section>
                  {risk && <p className="risk-callout" style={{ marginBottom: 10 }}>风险发布原因 · {row.riskConclusion}</p>}
                  <ActionForm action={releaseTrialAction} hidden={releaseFields}
                    submitText="发布全项目共享试制版本" submitClassName="button-sm"
                    confirmMessage={`全部 ${row.versionProjectCount} 个使用项目将同步使用 ${title} 试制版本。`}>
                    <label className="field">
                      <span className="label">试制电子流网址 <span className="required-mark" aria-hidden="true">*</span></span>
                      <input className="input" name="trialFormNo" type="url" required placeholder="https://eflow.example.com/trials/160" />
                    </label>
                    <label className="field">
                      <span className="label">试制评审纪要 <span className="required-mark" aria-hidden="true">*</span></span>
                      <textarea className="textarea" name="reviewMinutes" required maxLength={2000} />
                    </label>
                  </ActionForm>
                </FormDialog>
                <FormDialog label={risk ? "撤回风险试制" : "放弃"} title={risk ? `撤回 ${title} 风险试制` : `放弃发布 ${title} 试制`}
                  description={risk ? "该版本将退出风险发布队列，待转测申请和集成测试继续进行。" : "该版本将作废，所有使用项目均停止发布该版本。"}
                  triggerClassName="button button-ghost button-sm" cancelLabel="取消">
                  <WorkflowPackageName {...identity} />
                  <ActionForm action={abandonTrialReleaseAction} hidden={releaseFields}
                    submitText={risk ? "确认撤回风险试制" : "提交结论并放弃试制"} submitVariant={risk ? "secondary" : "danger"} submitClassName="button-sm"
                    confirmMessage={risk ? `${title} 将退出风险试制队列，转测与测试继续。` : `${title} 将在全部使用项目中作废。`}>
                    <label className="field">
                      <span className="label">{risk ? "撤回原因" : "放弃发布试制结论"} <span className="required-mark" aria-hidden="true">*</span></span>
                      <textarea className="textarea" name="conclusion" required minLength={5} />
                    </label>
                  </ActionForm>
                </FormDialog>
                {risk && <VersionVoidDialog versionId={row.versionId} code={identity.code} version={row.version}
                  returnFields={{ ...releaseFields, voidFrom: "trial-queue" }} triggerClassName="button button-outline-danger button-sm" />}
              </>}
              <Link href={workflowHref("/trial/ready/" + row.requestId, projectId, query)} className="button button-ghost button-sm" prefetch={false}>详情</Link>
            </div>
          );
        }}
      />}

      {showBindings && <TrialQueueTable
        kind="binding" title="试制版本绑定验证" rows={trials} columns={bindingColumns} query={query} projectId={projectId}
        rowKey={(row) => row.requestId} details={(row) => [row.packageCode, row.projectCode]}
        emptyTitle="没有正在绑定验证的试制版本"
        actions={(row) => <Link href={workflowHref("/trial/" + row.requestId, projectId, query)} prefetch={false} className="archive-link">
          {row.bindingMode === "PENDING" && canManageProjectWorkflowForProject(user, row.projectId) ? "决定绑定方式" : "查看节点与审批"} <ArrowRight size={12} />
        </Link>}
      />}
    </>
  );
}
