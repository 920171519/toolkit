import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ClipboardList } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { canManageProjectWorkflowForProject } from "@/lib/access";
import { getRiskTrialEntries } from "@/lib/trial-risk-entry";
import { batchSelectionKey } from "@/lib/batch-preparation";
import { DEFAULT_LIST_PAGE_SIZE, getListPageSize } from "@/lib/list-pagination";
import { getTransferPackageOptions, parseFlash } from "@/lib/queries";
import { requireWorkflowProject } from "@/lib/project-scope";
import { workflowHref } from "@/lib/workflow-links";
import { getWorkflowListState, getWorkflowPage, getWorkflowSearch, workflowSearchMatcher } from "@/lib/workflow-list";
import {
  getBatchCount,
  getBatches,
  getPendingTransferGroups,
  getWorkflowProjectScope,
} from "@/lib/workflow-queries";
import { formatDateTime } from "@/lib/format";
import { Badge, EmptyState, FlashMessage, PageHeader } from "@/components/ui";
import { PendingTransferTable } from "@/components/pending-transfer-table";
import { WorkflowQueueNav } from "@/components/workflow-queue-nav";
import { WorkflowListPagination, WorkflowListSearch } from "@/components/workflow-list";
import styles from "@/components/workflow-queue.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "待转测申请" };

export default async function SubmissionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const { returnTo } = getWorkflowListState(params);
  const notice = parseFlash(params.flash, params.tone === "error" ? "error" : "success");
  const project = requireWorkflowProject(user, params.project);
  const archived = project?.status === "ARCHIVED";
  const scope = project ? [project.id] : getWorkflowProjectScope(user);
  const groups = getPendingTransferGroups(scope);
  const canRequest = getTransferPackageOptions(user, project?.id).length > 0;
  const canPrepare = !archived && (project ? canManageProjectWorkflowForProject(user, project.id) : user.role === "ADMIN" || user.role === "SOFTWARE_MANAGER");
  const showDrafts = canPrepare && params.view === "drafts";
  const query = getWorkflowSearch(params.q);
  const pageSize = getListPageSize(params.pageSize);
  const matches = workflowSearchMatcher(query);
  const requestCount = groups.reduce((total, group) => total + group.items.length, 0);
  const visibleGroups = showDrafts ? [] : groups.map((group) => ({
    ...group,
    items: group.items.filter((item) => matches(item.packageName, item.packageCode, item.version, group.projectName, group.projectCode, item.ownerName, item.submittedByName)),
  })).filter((group) => group.items.length > 0);
  const riskEntries = getRiskTrialEntries(visibleGroups.flatMap((group) =>
    !archived && canManageProjectWorkflowForProject(user, group.projectId) ? group.items.map((item) => item.requestId) : [],
  ));
  const draftFilters = { statuses: ["DRAFT"] as ["DRAFT"], activeProjectsOnly: true };
  const draftsCount = canPrepare ? getBatchCount(scope, draftFilters) : 0;
  const matchingDrafts = showDrafts && query ? getBatchCount(scope, { ...draftFilters, query }) : draftsCount;
  const page = getWorkflowPage(matchingDrafts, pageSize, params.page);
  const drafts = showDrafts ? getBatches(pageSize, scope, { ...draftFilters, query, offset: page.offset }) : [];
  const queueHref = (draft: boolean, searchTerm = query, nextPage = 1) => workflowHref("/submissions", project?.id, {
    view: draft ? "drafts" : undefined,
    q: searchTerm || undefined,
    page: nextPage > 1 ? nextPage : undefined,
    pageSize: pageSize !== DEFAULT_LIST_PAGE_SIZE ? pageSize : undefined,
    returnTo,
  });
  const requestsHref = queueHref(false, showDrafts ? "" : query);
  const draftsHref = queueHref(true, showDrafts ? query : "");
  const integrationHref = workflowHref("/integration", project?.id, { view: archived ? "history" : undefined, returnTo });
  const returnState = {
    q: query || undefined,
    page: page.current > 1 ? page.current : undefined,
    pageSize: pageSize !== DEFAULT_LIST_PAGE_SIZE ? pageSize : undefined,
    returnTo,
  };
  const requestsByProject = new Map(groups.map((group) => [group.projectId, group.items]));

  return (
    <>
      <PageHeader
        title="转测申请"
        description={archived ? "项目已归档" : undefined}
        actions={<>
          <Link href={integrationHref} prefetch={false} className="button button-secondary">{archived ? "查看历史批次" : "查看在测批次"} <ArrowRight size={14} /></Link>
          {canRequest && <Link href={workflowHref("/submissions/transfer", project?.id, { returnTo })} prefetch={false} className="button button-primary" data-testid="submit-transfer-trigger"><ClipboardList size={14} /> 提交转测申请</Link>}
        </>}
      />
      <FlashMessage notice={notice} />

      {canPrepare && <WorkflowQueueNav label="转测工作队列" views={[
        { label: "待安排申请", href: requestsHref, count: requestCount, current: !showDrafts },
        { label: "待发起批次", href: draftsHref, count: draftsCount, current: showDrafts },
      ]} />}

      {showDrafts ? (
        <section className="card" aria-label="待发起转测批次">
          <div className={`card-header ${styles.listHeader}`}>
            <h2 className={styles.tableHeading}>待发起批次</h2>
            <WorkflowListSearch action="/submissions" label="批次号、标题或项目" query={query} pageSize={pageSize} fields={{ project: project?.id, view: "drafts", returnTo }} />
          </div>
          {drafts.length === 0 ? (query
            ? <EmptyState title="没有匹配的批次" action={<Link href={queueHref(true, "")} prefetch={false} className="button button-secondary button-sm">清除搜索</Link>} />
            : <EmptyState title="没有待发起的批次" action={<Link href={requestsHref} prefetch={false} className="button button-secondary">查看待安排申请</Link>} />) : (
            <div className={`table-wrap ${styles.queueTable}`} role="region" aria-label="待发起转测批次表格" tabIndex={0}>
              <table className="data-table">
                <thead><tr><th>批次</th><th>项目</th><th>配套与变更</th><th>创建时间</th><th aria-label="操作" /></tr></thead>
                <tbody>
                  {drafts.map((batch) => (
                    <tr key={batch.id}>
                      <td><strong className="mono">{batch.code}</strong><div className="small muted">{batch.title}</div></td>
                      <td><span className="chip">{batch.projectName}</span></td>
                      <td>{batch.itemCount} 个包 · {batch.changedCount} 个变更</td>
                      <td className="small muted">{formatDateTime(batch.createdAt)}</td>
                      <td className="cell-actions"><Link href={workflowHref(`/integration/${batch.id}`, project?.id, returnState)} prefetch={false} className="button button-secondary button-sm" aria-label={`核对 ${batch.code} 配套`}>核对并发起 <ArrowRight size={12} /></Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <WorkflowListPagination label="草稿列表分页" current={page.current} pages={page.pages} href={(nextPage) => queueHref(true, query, nextPage)} />
        </section>
      ) : (
      <section className="card">
        <div className={`card-header ${styles.listHeader}`}>
          <h2 className={styles.tableHeading}>待安排申请</h2>
          {!canPrepare && <Badge tone="slate">{requestCount} 个</Badge>}
          <WorkflowListSearch action="/submissions" label="软件包、版本、项目或人员" query={query} pageSize={pageSize} fields={{ project: project?.id, returnTo }} />
        </div>
        <div className="card-body">
          {visibleGroups.length === 0 ? (
            query ? <EmptyState title="没有匹配的申请" action={<Link href={queueHref(false, "")} prefetch={false} className="button button-secondary button-sm">清除搜索</Link>} />
              : <EmptyState title="没有待转测的申请" />
          ) : (
            <div className={styles.stack}>
              {visibleGroups.map((group) => {
                const managesGroup = canManageProjectWorkflowForProject(user, group.projectId);
                const defaults: Record<number, number> = {};
                const versionPackages: Record<number, number> = {};
                if (managesGroup) {
                  for (const item of requestsByProject.get(group.projectId) ?? []) {
                    if (!item.canInclude) continue;
                    defaults[item.packageId] ??= item.versionId;
                    versionPackages[item.versionId] = item.packageId;
                  }
                }
                return <PendingTransferTable
                  key={group.projectId}
                  group={{ ...group, items: group.items.map((item) => ({
                    ...item,
                    riskEntry: riskEntries[item.requestId],
                    canCancel: item.versionStatus === "PENDING_TRANSFER" && (managesGroup || user.id === item.submittedById),
                  })) }}
                  scopeProjectId={project?.id}
                  pageSize={pageSize}
                  selection={Object.keys(defaults).length > 0 ? { key: batchSelectionKey(user.id, group.projectId), defaults, versionPackages } : undefined}
                  returnState={returnState}
                />;
              })}
            </div>
          )}
        </div>
      </section>
      )}
    </>
  );
}
