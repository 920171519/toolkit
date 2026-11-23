import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { packageIdentity } from "@/lib/package-identity";
import { requireWorkflowProject } from "@/lib/project-scope";
import { readTraceListState, traceColumnFields, traceHref, traceListParams, withTraceTab } from "@/lib/version-trace-list";
import { workflowHref } from "@/lib/workflow-links";
import { getTraceVersionPage, getTraceVersionTabs } from "@/lib/workflow-queries";
import { ColumnFilterHeader } from "@/components/column-filter-header";
import { DirectoryFilterBar, DirectoryPagination } from "@/components/settings-directory";
import { EmptyState, PageHeader, StatusPill } from "@/components/ui";
import { WorkflowListSearch } from "@/components/workflow-list";
import { VersionTraceTabs } from "./trace-tabs";
import styles from "./versions.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "版本全链路" };

const columns = [
  { key: "package", label: "软件包" },
  { key: "version", label: "版本" },
  { key: "status", label: "版本状态" },
  { key: "submitted", label: "提交时间" },
] as const;

export default async function VersionsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const project = requireWorkflowProject(user, params.project);
  const requested = readTraceListState(params);
  const tabs = getTraceVersionTabs(requested.tabs, project?.id);
  const { rows, total, page, pageCount } = getTraceVersionPage(requested, project?.id);
  const state = { ...requested, page, tabs: tabs.map((tab) => tab.id) };
  const listParams = {
    ...traceListParams(state),
    project: project ? String(project.id) : undefined,
    sort: state.sort,
    dir: state.direction,
  };

  return (
    <>
      <PageHeader
        title="版本全链路"
        actions={<Link href={workflowHref("/packages", project?.id, { open: state.packageId, returnTo: state.returnTo })} className="button button-secondary">软件版本总览</Link>}
      />
      <VersionTraceTabs state={state} tabs={tabs} projectId={project?.id} />
      <section className="card">
        <div className="card-header">
          <WorkflowListSearch action="/versions" label="软件包或版本" query={state.query} pageSize={state.pageSize} showPageSize={false} fields={{
            project: project?.id, package: state.packageId, sort: state.sort, dir: state.direction, tabs: listParams.tabs, returnTo: state.returnTo, ...state.filters,
          }} />
        </div>
        {state.packageId && (
          <div className={styles.packageScope}>
            <Link href={traceHref({ ...state, page: 1, packageId: undefined }, project?.id)} className="button button-secondary button-sm" prefetch={false}>全部软件包</Link>
          </div>
        )}
        <DirectoryFilterBar path="/versions" params={listParams} />
        <div className={styles.tableWrap} role="region" aria-label="版本记录表格" tabIndex={0}>
          <table className="data-table">
            <thead>
              <tr>
                {columns.map(({ key, label }) => {
                  const descendingNext = state.sort === key && state.direction === "asc";
                  return (
                    <ColumnFilterHeader
                      key={key}
                      label={label}
                      path="/versions"
                      params={listParams}
                      fields={[traceColumnFields[key]]}
                      sortKey={key}
                      orderParam="dir"
                      sortLabel={`按${label}${descendingNext ? "降序" : "升序"}`}
                    />
                  );
                })}
                <th scope="col" aria-label="操作" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const href = traceHref(withTraceTab(state, row.id), project?.id, row.id);
                const identity = packageIdentity({ name: row.packageName, code: row.packageCode });
                return (
                  <tr key={row.id}>
                    <td>
                      <strong className="mono">{identity.code}</strong>
                      {identity.name !== identity.code && <span className={`small muted ${styles.packageName}`} title={identity.name}>{identity.name}</span>}
                    </td>
                    <td><Link href={href} className="version-badge" prefetch={false}>{row.version}</Link></td>
                    <td><StatusPill status={row.status} /></td>
                    <td className="small muted">{formatDateTime(row.submittedAt)}</td>
                    <td className="cell-actions"><Link href={href} className="archive-link" prefetch={false}>全链路追溯 <ArrowRight size={11} aria-hidden="true" /></Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && <EmptyState title="未找到版本" />}
        <DirectoryPagination path="/versions" params={listParams} page={page} pages={pageCount} pageSize={state.pageSize} total={total} unit="条" label="版本列表分页" />
      </section>
    </>
  );
}
