import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { canManageProjectWorkflowForProject } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { DEFAULT_LIST_PAGE_SIZE, getListPageSize } from "@/lib/list-pagination";
import { requireWorkflowProject } from "@/lib/project-scope";
import { parseFlash } from "@/lib/queries";
import { workflowHref } from "@/lib/workflow-links";
import { getWorkflowListState, getWorkflowPage, getWorkflowSearch, workflowSearchMatcher } from "@/lib/workflow-list";
import { getPendingFormalVersions, getWorkflowProjectScope } from "@/lib/workflow-queries";
import { WorkflowListPagination, WorkflowListSearch } from "@/components/workflow-list";
import { Badge, EmptyState, FlashMessage, PageHeader } from "@/components/ui";
import styles from "@/components/workflow-queue.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "转正发布" };

export default async function FormalPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const { returnTo } = getWorkflowListState(params);
  const notice = parseFlash(params.flash, params.tone === "error" ? "error" : "success");
  const project = requireWorkflowProject(user, params.project);
  const archived = project?.status === "ARCHIVED";
  const rawVersions = getPendingFormalVersions(project ? [project.id] : getWorkflowProjectScope(user));
  const groups = new Map<number, typeof rawVersions>();
  for (const version of rawVersions) {
    const group = groups.get(version.versionId) ?? [];
    group.push(version);
    groups.set(version.versionId, group);
  }

  const query = getWorkflowSearch(params.q);
  const pageSize = getListPageSize(params.pageSize);
  const matches = workflowSearchMatcher(query);
  const matching = [...groups.values()]
    .filter((group) => group.some((version) => matches(version.packageName, version.packageCode, version.version, version.projectName, version.projectCode, version.trialFormNo)))
    .sort((left, right) => right[0].isOverdue - left[0].isOverdue);
  const page = getWorkflowPage(matching.length, pageSize, params.page);
  const listHref = (searchTerm = query, nextPage = 1) => workflowHref("/formal", project?.id, {
    q: searchTerm || undefined,
    page: nextPage > 1 ? nextPage : undefined,
    pageSize: pageSize !== DEFAULT_LIST_PAGE_SIZE ? pageSize : undefined,
    returnTo,
  });
  const listState = {
    q: query || undefined, page: page.current > 1 ? page.current : undefined,
    pageSize: pageSize !== DEFAULT_LIST_PAGE_SIZE ? pageSize : undefined,
    returnTo,
  };
  const versions = matching.slice(page.offset, page.end);

  return (
    <>
      <PageHeader
        title="转正发布"
        description={archived ? "项目已归档" : undefined}
        actions={<Link href={workflowHref(archived ? "/versions" : "/trial", project?.id, { view: archived ? undefined : "binding", returnTo })} prefetch={false} className="button button-secondary">{archived ? "查看版本全链路" : "查看绑定验证"} <ArrowRight size={14} /></Link>}
      />
      <FlashMessage notice={notice} />
      <section className="card">
        <div className={`card-header ${styles.listHeader}`}>
          <h2 className={styles.tableHeading}>待转正版本</h2><Badge tone="slate">{matching.length} 个版本</Badge>
          <WorkflowListSearch action="/formal" label="软件包、版本或项目" query={query} pageSize={pageSize} fields={{ project: project?.id, returnTo }} />
        </div>
        {versions.length === 0 ? (
          query ? <EmptyState title="没有匹配的版本" action={<Link href={listHref("")} prefetch={false} className="button button-secondary button-sm">清除搜索</Link>} />
            : <EmptyState title="没有待转正的版本" />
        ) : (
          <div className={`table-wrap ${styles.queueTable}`} role="region" aria-label="待转正版本列表" tabIndex={0}>
            <table className="data-table">
              <thead><tr><th scope="col">软件包版本</th><th scope="col">节点验证</th><th scope="col">项目</th><th scope="col">试制发布</th><th scope="col">操作</th></tr></thead>
              <tbody>{versions.map((group) => {
                const version = group[0];
                const canRelease = group.some((record) => canManageProjectWorkflowForProject(user, record.projectId));
                const skipped = version.bindingMode === "SKIPPED";
                const kind = version.releaseMode === "RISK";
                const passed = group.reduce((count, row) => count + row.requirementPassed, 0);
                const waived = group.reduce((count, row) => count + row.requirementWaived, 0);
                const total = group.reduce((count, row) => count + row.requirementTotal, 0);
                const href = workflowHref(`/formal/${version.versionId}`, project?.id, listState);
                return <tr key={version.versionId}>
                  <th scope="row">
                    <Link href={href} className="archive-link" prefetch={false}>{version.packageName} <strong className="mono">{version.version}</strong></Link>
                    <p className={styles.tableExcerpt} title={version.changeSummary}>{version.changeSummary}</p>
                  </th>
                  <td><Badge tone={skipped ? "slate" : "emerald"}>{skipped ? "无需绑定" : `${passed}/${total} 节点通过`}</Badge>{waived > 0 && <div className="small muted">{waived} 个节点免绑</div>}</td>
                  <td>{group.map((item) => item.projectName).join("、")}</td>
                  <td className={styles.nowrap}>
                    <div className="small muted">{formatDateTime(version.trialReleasedAt)}</div>
                    {kind && <Badge tone="amber">风险发布</Badge>} {version.isOverdue ? <Badge tone="rose">已超期</Badge> : null}
                  </td>
                  <td className="cell-actions"><Link href={href} prefetch={false} className={`button ${canRelease ? "button-primary" : "button-secondary"} button-sm`}>{canRelease ? "核对并转正" : "查看验收记录"} <ArrowRight size={14} aria-hidden="true" /></Link></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        )}
        <WorkflowListPagination label="转正列表分页" current={page.current} pages={page.pages} href={(nextPage) => listHref(query, nextPage)} />
      </section>
    </>
  );
}
