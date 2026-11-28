import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { FormDialog } from "@/components/form-dialog";
import { ReleaseFlowEvidence } from "@/components/release-flow-evidence";
import { TrialQueueTable, type TrialTableColumn } from "@/components/trial-queue-table";
import { TrialReleaseAction } from "@/components/trial-release-action";
import { Badge, FlashMessage, PageHeader } from "@/components/ui";
import styles from "@/components/trial-queue-table.module.css";
import { WorkflowQueueNav } from "@/components/workflow-queue-nav";
import { WorkflowPackageName } from "@/components/workflow-package-name";
import { VersionVoidDialog } from "@/components/version-void-dialog";
import { getWorkflowListState } from "@/lib/workflow-list";
import { getAssignedTrialRequestIds, getBatchEvidenceReadScope, getManagedProjectScope, getProjectWorkflowProjectIds, getReadableLinkedBatchEvidence } from "@/lib/access";
import { abandonTrialReleaseAction } from "@/lib/actions/release";
import { requireUser } from "@/lib/auth";
import { packageIdentity } from "@/lib/package-identity";
import { requireWorkflowProject } from "@/lib/project-scope";
import { readFlash } from "@/lib/flash";
import { trialBindingStatuses, trialQueueKey, trialQueueParams, trialReleaseStatuses, type TrialSearchParams } from "@/lib/trial-queue";
import { getTrialReadyDisplayVersions, getTrialReadyVersionCount, trialReleaseStateKey, type TrialReadyDisplayVersion } from "@/lib/trial-eligibility";
import { workflowHref } from "@/lib/workflow-links";
import { getReadableTrialQueueCounts } from "@/lib/binding-queries";
import { getTrialVersionCount, getTrialVersions, type TrialVersionRow } from "@/lib/release-queue-queries";
import identityStyles from "@/components/package-identity.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "试制与绑定验证" };

function displayPackage({ packageName, packageCode }: Pick<TrialReadyDisplayVersion, "packageName" | "packageCode">) {
  return packageIdentity({ name: packageName, code: packageCode });
}

function riskRelease(row: TrialReadyDisplayVersion) {
  return row.riskProjectCount > 0;
}

function readyBatchLabel(row: TrialReadyDisplayVersion) {
  if (row.batch) return row.batch.batchCode ?? "未关联转测批次";
  return row.hasLinkedBatch ? "—" : "未关联转测批次";
}

function readyStatus(row: TrialReadyDisplayVersion) {
  return trialReleaseStatuses[riskRelease(row) ? "RISK" : "READY"];
}

function bindingStatusOptions(row: TrialVersionRow) {
  const statuses: Array<keyof typeof trialBindingStatuses> = [row.bindingMode];
  if (row.releaseMode === "RISK" || !row.batchId) statuses.push("RISK");
  if (row.isOverdue) statuses.push("OVERDUE");
  return statuses.map((value) => ({ value, label: trialBindingStatuses[value] }));
}

function batchLink(row: Pick<TrialVersionRow, "batchId" | "batchCode">, projectId?: number) {
  if (!row.batchId) return <span className="small muted">未关联转测批次</span>;
  return <Link href={workflowHref("/integration/" + row.batchId, projectId)} className="archive-link" prefetch={false}>
    {row.batchCode ? <span className="mono">{row.batchCode}</span> : "查看批次"}
  </Link>;
}

export default async function TrialPage({ searchParams }: { searchParams: Promise<TrialSearchParams> }) {
  const user = await requireUser();
  const params = await searchParams;
  const notice = readFlash(params);
  const project = requireWorkflowProject(user, params.project);
  const projectId = project?.id;
  const scope = project ? [project.id] : getProjectWorkflowProjectIds(user);
  const managerScope = getManagedProjectScope(user);
  const managedProjects = managerScope === null ? null : new Set(managerScope);
  const managesActiveProject = (id: number) => managedProjects === null || managedProjects.has(id);
  const archived = project?.status === "ARCHIVED";
  const canViewReleaseQueue = !archived && (project ? managesActiveProject(project.id) : managerScope === null || managerScope.length > 0);
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
  const releaseScope = projectId === undefined ? managerScope : [projectId];
  const byVersion = new Map<number, TrialReadyDisplayVersion[]>();
  if (!showBindings) {
    for (const request of getTrialReadyDisplayVersions(user, releaseScope)) {
      const records = byVersion.get(request.versionId);
      if (records) records.push(request);
      else byVersion.set(request.versionId, [request]);
    }
  }
  const ready = [...byVersion.values()].map((records) => ({
    ...(records.find((row) => managesActiveProject(row.projectId)) ?? records[0]),
    records,
  })).sort((first, second) => Number(riskRelease(first)) - Number(riskRelease(second)));
  const releaseCount = showBindings && canViewReleaseQueue ? getTrialReadyVersionCount(releaseScope) : ready.length;
  const canReadProject = (id: number) => scope === null || scope.includes(id);
  const assignedRequestIds = !project && scope !== null ? getAssignedTrialRequestIds(user) : [];
  const batchScope = showBindings ? getBatchEvidenceReadScope(user) : undefined;
  const trialRows = showBindings ? getTrialVersions(scope, assignedRequestIds) : [];
  const assignedCounts = getReadableTrialQueueCounts(user, trialRows
    .filter((row) => !canReadProject(row.projectId)).map((row) => row.requestId));
  const trials = trialRows.flatMap((row) => {
    if (canReadProject(row.projectId)) return [{ ...row, readableBatch: getReadableLinkedBatchEvidence(user, row, batchScope) }];
    const counts = assignedCounts.get(row.requestId);
    return counts ? [{ ...row, ...counts, readableBatch: null }] : [];
  }).sort((first, second) => second.isOverdue - first.isOverdue || second.pendingFlowCount - first.pendingFlowCount);
  const bindingCount = showBindings ? trials.length : getTrialVersionCount(scope, assignedRequestIds);
  const packageLink = (row: TrialReadyDisplayVersion | TrialVersionRow) => (
    <Link href={workflowHref("/packages", projectId, { open: row.packageId })} prefetch={false} className={`archive-link mono ${identityStyles.code}`}>{displayPackage(row).code}</Link>
  );

  const identityColumns: TrialTableColumn<TrialReadyDisplayVersion | TrialVersionRow>[] = [
    {
      key: "package",
      label: "软件包",
      filterLabel: "软件包编码或名称",
      sortLabel: "按软件包编码排序",
      value: (row) => displayPackage(row).code,
      filterValues: (row) => {
        const { code, name } = displayPackage(row);
        return [code, name];
      },
      cell: packageLink,
    },
    { key: "version", label: "版本", value: (row) => row.version, cell: (row) => <span className={`mono ${styles.version}`}>{row.version}</span> },
  ];
  const submitterColumn: TrialTableColumn<TrialReadyDisplayVersion | TrialVersionRow> = {
    key: "submitter", label: "提交人", value: (row) => row.submittedByName ?? "未知",
  };
  const releaseColumns: TrialTableColumn<(typeof ready)[number]>[] = [
    ...identityColumns,
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
      value: (row) => row.records.map(readyBatchLabel).join("、"),
      filterValues: (row) => row.records.map(readyBatchLabel),
      cell: (row) => <div className={styles.bindingStatus}>{row.records.map((record) => <span key={record.requestId}>
        {record.batch ? batchLink(record.batch, record.batch.batchProjectId) : <span className="small muted">{readyBatchLabel(record)}</span>}
      </span>)}</div>,
    },
    submitterColumn,
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
  const bindingBatchLabel = (row: (typeof trials)[number]) => {
    if (row.readableBatch) return row.readableBatch.batchCode ?? "未关联转测批次";
    return canReadProject(row.projectId) && row.batchId === null ? "未关联转测批次" : "—";
  };
  const bindingColumns: TrialTableColumn<(typeof trials)[number]>[] = [
    ...identityColumns,
    { key: "project", label: "项目", value: (row) => row.projectName, choices: (row) => [{ value: String(row.projectId), label: row.projectName }] },
    {
      key: "batch",
      label: "转测批次",
      value: bindingBatchLabel,
      cell: (row) => row.readableBatch
        ? batchLink(row.readableBatch, projectId === undefined ? undefined : row.readableBatch.batchProjectId)
        : <span className="small muted">{bindingBatchLabel(row)}</span>,
    },
    submitterColumn,
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
        actions={<>
          {canViewReleaseQueue && !showBindings && <Link href={workflowHref("/versions", projectId, { q: queueParams.release_q, returnTo })}
            className="button button-secondary" prefetch={false}>按版本检查试制条件</Link>}
          <Link href={workflowHref(archived ? "/versions" : "/formal", projectId, { returnTo })} className="button button-secondary" prefetch={false}>{archived ? "查看版本全链路" : "查看待转正版本"} <ArrowRight size={14} aria-hidden="true" /></Link>
        </>} />
      <FlashMessage notice={notice} />

      {canViewReleaseQueue && <WorkflowQueueNav label="试制与绑定队列" views={[
        { label: "待发布试制", href: queueHref(false), count: releaseCount, current: !showBindings },
        { label: "节点绑定", href: queueHref(true), count: bindingCount, current: showBindings, nativeNavigation: !showBindings },
      ]} />}

      {!showBindings && <TrialQueueTable
        kind="release" title="待发布试制" rows={ready} columns={releaseColumns} query={query} projectId={projectId}
        rowKey={(row) => row.versionId} details={(row) => [displayPackage(row).name, ...row.records.map((record) => record.projectCode)]}
        emptyTitle="没有待发试制的项目版本"
        actions={(row) => {
          const risk = riskRelease(row);
          const identity = displayPackage(row);
          const title = `${identity.code} ${row.version}`;
          const releaseFields = { ...query, requestId: row.requestId, scopeProjectId: projectId, eligibility: trialReleaseStateKey(row) };
          return (
            <div className={styles.actions}>
              {managesActiveProject(row.projectId) && <>
                <TrialReleaseAction actor={user} row={row} records={row.records} projectId={projectId} query={query} />
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
        rowKey={(row) => row.requestId} details={(row) => [displayPackage(row).name, row.projectCode]}
        emptyTitle="没有正在绑定验证的试制版本"
        actions={(row) => <Link href={workflowHref("/trial/" + row.requestId, projectId, query)} prefetch={false} className="archive-link">
          {row.bindingMode === "PENDING" && managesActiveProject(row.projectId) ? "决定绑定方式" : "查看节点与审批"} <ArrowRight size={12} />
        </Link>}
      />}
    </>
  );
}
