import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDown, ArrowDownUp, ArrowRight, ArrowUp } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { PACKAGE_STATUS_META, PACKAGE_STATUSES } from "@/lib/constants";
import { formatDateTime } from "@/lib/format";
import { LIST_PAGE_SIZES } from "@/lib/list-pagination";
import { requireWorkflowProject } from "@/lib/project-scope";
import { readTraceListState, traceHref, withTraceTab } from "@/lib/version-trace-list";
import { workflowHref } from "@/lib/workflow-links";
import { getTraceVersionPage, getTraceVersionTabs } from "@/lib/workflow-queries";
import { EmptyState, PageHeader, StatusPill } from "@/components/ui";
import { TraceFilterForm } from "./trace-filter-form";
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
  const hasFilters = Boolean(state.query || state.packageFilter || state.versionFilter || state.status || state.submittedFrom || state.submittedThrough);
  const cleared = { ...state, query: "", packageFilter: "", versionFilter: "", status: undefined, submittedFrom: undefined, submittedThrough: undefined, page: 1 };

  return (
    <>
      <PageHeader
        title="版本全链路"
        actions={<Link href={workflowHref("/packages", project?.id, { open: state.packageId })} className="button button-secondary">软件版本总览</Link>}
      />
      <VersionTraceTabs state={state} tabs={tabs} projectId={project?.id} />
      <section className="card">
        <TraceFilterForm currentHref={traceHref(state, project?.id)} projectId={project?.id}>
          {project && <input type="hidden" name="project" value={project.id} />}
          {state.packageId && <input type="hidden" name="package" value={state.packageId} />}
          {state.tabs.length > 0 && <input type="hidden" name="tabs" value={state.tabs.join(",")} />}
          <input type="hidden" name="sort" value={state.sort} />
          <input type="hidden" name="dir" value={state.direction} />
          <div className={`card-body ${styles.toolbar}`}>
            <label className={`field ${styles.search}`}>
              <span className="label">软件包或版本</span>
              <input className="input" name="q" defaultValue={state.query} maxLength={100} placeholder="例如 1001OTA 1.6.0" />
            </label>
            <button type="submit" className={`button button-primary ${styles.manualSearch}`}>搜索</button>
            {hasFilters && <Link href={traceHref(cleared, project?.id)} className="button button-secondary" prefetch={false}>清除筛选</Link>}
            {state.packageId && <Link href={traceHref({ ...state, page: 1, packageId: undefined }, project?.id)} className="button button-secondary" prefetch={false}>全部软件包</Link>}
          </div>
          <div className={styles.tableWrap} role="region" aria-label="版本记录表格" tabIndex={0}>
            <table className="data-table">
              <thead>
                <tr>
                  {columns.map(({ key, label }) => {
                    const sorted = state.sort === key;
                    const ascending = state.direction === "asc";
                    const nextDirection = sorted && ascending ? "desc" : "asc";
                    const Icon = sorted ? ascending ? ArrowUp : ArrowDown : ArrowDownUp;
                    return (
                      <th key={key} scope="col" aria-sort={sorted ? ascending ? "ascending" : "descending" : undefined}>
                        <Link
                          href={traceHref({ ...state, sort: key, direction: nextDirection, page: 1 }, project?.id)}
                          className={`${styles.sortLink} ${sorted ? styles.sorted : ""}`}
                          aria-label={`按${label}${nextDirection === "asc" ? "升序" : "降序"}`}
                          prefetch={false}
                        >
                          {label} <Icon size={12} aria-hidden="true" />
                        </Link>
                      </th>
                    );
                  })}
                  <th scope="col" aria-label="操作" />
                </tr>
                <tr className={styles.filterRow}>
                  <td><input className="input" name="pkg" aria-label="筛选软件包" defaultValue={state.packageFilter} maxLength={100} placeholder="名称或编码" /></td>
                  <td><input className="input" name="ver" aria-label="筛选版本号" defaultValue={state.versionFilter} maxLength={100} placeholder="版本号" /></td>
                  <td>
                    <select className="select" name="status" aria-label="筛选版本状态" defaultValue={state.status ?? ""}>
                      <option value="">所有状态</option>
                      {PACKAGE_STATUSES.map((status) => <option key={status} value={status}>{PACKAGE_STATUS_META[status].label}</option>)}
                    </select>
                  </td>
                  <td>
                    <div className={styles.dates}>
                      <input className="input" type="date" name="from" aria-label="提交起始日期" defaultValue={state.submittedFrom} />
                      <input className="input" type="date" name="to" aria-label="提交截止日期" defaultValue={state.submittedThrough} />
                    </div>
                  </td>
                  <td />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const href = traceHref(withTraceTab(state, row.id), project?.id, row.id);
                  return (
                    <tr key={row.id}>
                      <td><strong>{row.packageName}</strong><div className="small muted">{row.packageCode}</div></td>
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
          {rows.length === 0 && <EmptyState title="未找到版本" description="可以调整表头筛选或搜索关键词。" />}
          <nav aria-label="版本列表分页" className={`card-body ${styles.pagination}`}>
            <span className="small muted" role="status">共 {total} 条</span>
            <label className={styles.pageSize}>
              <span className="small muted">每页条数</span>
              <select className="select" name="pageSize" defaultValue={state.pageSize}>
                {LIST_PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
              </select>
            </label>
            {page > 1 && <Link href={traceHref({ ...state, page: page - 1 }, project?.id)} className="button button-secondary button-sm" prefetch={false}>上一页</Link>}
            <span className="small muted">第 {page} / {pageCount} 页</span>
            {page < pageCount && <Link href={traceHref({ ...state, page: page + 1 }, project?.id)} className="button button-secondary button-sm" prefetch={false}>下一页</Link>}
          </nav>
        </TraceFilterForm>
      </section>
    </>
  );
}
