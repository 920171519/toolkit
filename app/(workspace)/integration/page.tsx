import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { canManageProjectWorkflowForProject, canSubmitIntegrationConclusionForProject, getManagedProjectScope, getProjectWorkflowProjectIds } from "@/lib/access";
import { BATCH_STATUS_META } from "@/lib/constants";
import { type BatchStatus } from "@/lib/domain-values";
import { ColumnFilterHeader } from "@/components/column-filter-header";
import { DirectoryFilterBar, DirectoryPagination } from "@/components/settings-directory";
import { filterOptions } from "@/lib/column-filters";
import { historyFields, integrationHistoryParams, readIntegrationHistory } from "@/lib/integration-history";
import { requireUser } from "@/lib/auth";
import { DEFAULT_LIST_PAGE_SIZE, getPageWindow } from "@/lib/list-pagination";
import { requireWorkflowProject } from "@/lib/project-scope";
import { readFlash } from "@/lib/flash";
import { workflowHref } from "@/lib/workflow-links";
import { getWorkflowListState, workflowListParams } from "@/lib/workflow-list";
import { getProjectOptions } from "@/lib/project-queries";
import { getBatchCount, getBatches, getIntegrationHistoryPage } from "@/lib/batch-queries";
import { formatDateTime } from "@/lib/format";
import { Badge, BatchStatusPill, EmptyState, FlashMessage, PageHeader } from "@/components/ui";
import { WorkflowQueueNav } from "@/components/workflow-queue-nav";
import { WorkflowListPagination, WorkflowListSearch } from "@/components/workflow-list";
import styles from "@/components/workflow-queue.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "集成测试" };

const conclusionLabel: Record<string, string> = { PASS: "测试通过", FAIL: "测试不通过", BLOCKED: "无法完成验证" };

export default async function IntegrationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const { q: query = "", page: requestedPage = 1, pageSize = DEFAULT_LIST_PAGE_SIZE, returnTo } = getWorkflowListState(params);
  const notice = readFlash(params);
  const project = requireWorkflowProject(user, params.project);
  const archived = project?.status === "ARCHIVED";
  const canArrange = project ? canManageProjectWorkflowForProject(user, project.id) : getManagedProjectScope(user)?.length !== 0;
  const scope = project ? [project.id] : getProjectWorkflowProjectIds(user, true);
  const activeStatuses: BatchStatus[] = ["IN_TEST"];
  const historyStatuses: BatchStatus[] = archived ? ["IN_TEST", "COMPLETED", "TERMINATED"] : ["COMPLETED", "TERMINATED"];
  const activeCount = archived ? 0 : getBatchCount(scope, { statuses: activeStatuses, activeProjectsOnly: true });
  const historyState = readIntegrationHistory(params);
  const hasHistoryFilters = Object.keys(historyState.filters).length > 0;
  const inHistory = archived || params.view === "history" || params.history === "1" || hasHistoryFilters;
  const filters = { statuses: activeStatuses, query, activeProjectsOnly: true };
  const total = inHistory ? 0 : query ? getBatchCount(scope, filters) : activeCount;
  const page = getPageWindow(total, pageSize, requestedPage);
  const visible = inHistory ? [] : getBatches(pageSize, scope, { ...filters, offset: page.offset });
  const history = inHistory ? getIntegrationHistoryPage(historyState, scope, { statuses: historyStatuses, query }) : undefined;
  const historyCount = archived ? 0 : history && !query && !hasHistoryFilters
    ? history.total : getBatchCount(scope, { statuses: historyStatuses });
  const historyParams = { ...integrationHistoryParams({ ...historyState, page: history?.page ?? 1 }), view: "history", q: query || undefined, returnTo };
  const filterHeader = { path: "/integration", params: { ...historyParams, project: project ? String(project.id) : undefined } };
  const projectOptions = inHistory ? project ? [project] : getProjectOptions(true).filter(({ id }) => scope === null || scope.includes(id)) : [];
  const projectField = { ...historyFields.project, options: filterOptions(projectOptions.map(({ id, name }) => ({ value: String(id), label: name }))) };
  const statusField = { ...historyFields.status, options: historyStatuses.map((value) => ({ value, label: BATCH_STATUS_META[value].label })) };
  const visibleProjectIds = new Set(inHistory ? [] : visible.map((batch) => batch.projectId));
  const testingRights = new Map([...visibleProjectIds].map((id) => [id, canSubmitIntegrationConclusionForProject(user, id)]));
  const queueHref = (showHistory: boolean, searchTerm = query, page = 1) => workflowHref("/integration", project?.id, {
    view: showHistory ? "history" : undefined,
    ...workflowListParams({ q: searchTerm, page, pageSize }),
    returnTo,
  });
  const detailHref = (id: number) => workflowHref(`/integration/${id}`, project?.id, {
    ...workflowListParams({ q: query, page: page.current, pageSize }),
    returnTo,
  });

  return (
    <>
      <PageHeader
        title="集成测试"
        description={archived ? "项目已归档" : undefined}
        actions={<Link href={workflowHref("/submissions", project?.id, { returnTo })} prefetch={false} className="button button-secondary">查看转测申请 <ArrowRight size={14} /></Link>}
      />
      <FlashMessage notice={notice} />
      {!archived && <WorkflowQueueNav label="集成测试队列" views={[
        { label: "在测批次", href: queueHref(false), count: activeCount, current: !inHistory },
        { label: "历史批次", href: inHistory ? workflowHref("/integration", project?.id, historyParams) : queueHref(true), count: historyCount, current: inHistory },
      ]} />}

      {history ? (
        <section id="integration-history" className="card">
          <div className={`card-header ${styles.listHeader}`}>
            <h2 className={styles.tableHeading}>历史批次</h2>
            <WorkflowListSearch action="/integration" label="批次号、标题或项目" query={query} pageSize={pageSize} showPageSize={false} fields={{ project: project?.id, view: "history", returnTo, ...historyState.filters }} />
          </div>
          <DirectoryFilterBar {...filterHeader} />
          <div className="table-wrap" tabIndex={0} role="region" aria-label="历史批次表格">
            <table className="data-table">
              <thead><tr>
                <ColumnFilterHeader {...filterHeader} label="批次" fields={[historyFields.batch, historyFields.title]} />
                <ColumnFilterHeader {...filterHeader} label="项目" fields={[projectField]} />
                <ColumnFilterHeader {...filterHeader} label="状态" fields={[statusField]} />
                <ColumnFilterHeader {...filterHeader} label="配套 / 变更" fields={[historyFields.items, historyFields.changed]} numeric />
                <ColumnFilterHeader {...filterHeader} label="结论" fields={[historyFields.conclusion]} />
                <ColumnFilterHeader {...filterHeader} label="时间" fields={[historyFields.date]} />
                <th scope="col" aria-label="操作" />
              </tr></thead>
              <tbody>{history.rows.map((batch) => {
                const detailHref = workflowHref(`/integration/${batch.id}`, project?.id, historyParams);
                return (
                    <tr key={batch.id}>
                      <td><Link href={detailHref} className="archive-link mono" prefetch={false}>{batch.code}</Link><div className="small muted">{batch.title}</div></td>
                      <td><span className="chip">{batch.projectName}</span></td>
                      <td><BatchStatusPill status={batch.status as BatchStatus} /></td>
                      <td className="cell-actions"><span className="mono small">{batch.itemCount} / {batch.changedCount}</span></td>
                      <td>{batch.conclusion ? <Badge tone={batch.conclusion === "PASS" ? "emerald" : batch.conclusion === "FAIL" ? "rose" : "amber"}>{conclusionLabel[batch.conclusion] ?? batch.conclusion}</Badge> : <span className="small muted">无测试结论</span>}</td>
                      <td className="small muted">{formatDateTime(batch.completedAt ?? batch.terminatedAt ?? batch.sentAt ?? batch.createdAt)}</td>
                      <td className="cell-actions"><Link href={detailHref} className="button button-secondary button-sm" prefetch={false}>查看记录</Link></td>
                    </tr>
                );
              })}</tbody>
            </table>
          </div>
          {history.rows.length === 0 && <EmptyState title={(query || hasHistoryFilters) ? "没有匹配的历史批次" : "暂无历史批次"}
            action={query || hasHistoryFilters
              ? <Link href={queueHref(true, "") + "#integration-history"} prefetch={false} className="button button-secondary button-sm">重置搜索与筛选</Link>
              : !archived ? <Link href={queueHref(false, "")} prefetch={false} className="button button-secondary button-sm">查看在测批次</Link> : undefined} />}
          <DirectoryPagination {...filterHeader} page={history.page} pages={history.pages} total={history.total} unit="个批次" pageSize={historyState.pageSize} label="历史批次分页" />
        </section>
      ) : <section className="card">
        <div className={`card-header ${styles.listHeader}`}>
          <h2 className={styles.tableHeading}>当前在测批次</h2>
          <WorkflowListSearch action="/integration" label="批次号、标题或项目" query={query} pageSize={pageSize} fields={{ project: project?.id, returnTo }} />
        </div>
        {visible.length === 0 ? (
          query ? <EmptyState title="没有匹配的批次" action={<Link href={queueHref(false, "")} prefetch={false} className="button button-secondary button-sm">清除搜索</Link>} /> : (
            <EmptyState title="当前没有在测批次" description={canArrange ? "草稿发起转测后，批次会进入此列表。" : "项目软件经理发起转测后，批次会进入此列表。"}
              action={<Link href={canArrange ? workflowHref("/submissions", project?.id, { view: "drafts", returnTo }) : queueHref(true, "")} prefetch={false}
                className="button button-secondary button-sm">{canArrange ? "查看待发起批次" : "查看历史批次"}</Link>} />
          )
        ) : (
          <div className={`table-wrap ${styles.queueTable}`} role="region" aria-label="在测批次列表" tabIndex={0}>
            <table className="data-table">
              <thead><tr><th scope="col">批次</th><th scope="col">项目</th><th scope="col">状态</th><th scope="col">配套与变更</th><th scope="col">发起时间</th><th scope="col">操作</th></tr></thead>
              <tbody>{visible.map((batch) => {
                const canTest = testingRights.get(batch.projectId);
                return (
                <tr key={batch.id}>
                  <th scope="row"><Link href={detailHref(batch.id)} prefetch={false} className="archive-link mono">{batch.code}</Link><div className="small muted">{batch.title}</div></th>
                  <td>{batch.projectName}</td>
                  <td><BatchStatusPill status={batch.status as BatchStatus} /></td>
                  <td>{batch.itemCount} 个包 · {batch.changedCount} 个变更</td>
                  <td className={`small muted ${styles.nowrap}`}>{formatDateTime(batch.sentAt)}</td>
                  <td className="cell-actions"><Link href={detailHref(batch.id)} prefetch={false} className={`button ${canTest ? "button-primary" : "button-secondary"} button-sm`}>{canTest ? "处理测试批次" : "查看批次进展"} <ArrowRight size={12} aria-hidden="true" /></Link></td>
                </tr>
              ); })}</tbody>
            </table>
          </div>
        )}
        <WorkflowListPagination label="批次列表分页" current={page.current} pages={page.pages} href={(nextPage) => queueHref(false, query, nextPage)} />
      </section>}
    </>
  );
}
