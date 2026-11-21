import Link from "next/link";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpDown, Search } from "lucide-react";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/ui";
import { LIST_PAGE_SIZES, getListPageSize } from "@/lib/list-pagination";
import { workflowHref } from "@/lib/workflow-links";
import { trialDefaultPageSize, trialQueueKey, type TrialColumnKey, type TrialQueueKind } from "@/lib/trial-queue";
import styles from "./trial-queue-table.module.css";

export type TrialTableColumn<Row> = {
  key: TrialColumnKey;
  label: string;
  value: (row: Row) => string | number;
  sortValue?: (row: Row) => string | number;
  cell?: (row: Row) => ReactNode;
  options?: string[];
};

const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
const normalize = (value: string | number) => String(value).normalize("NFKC").toLowerCase();

export function TrialQueueTable<Row>({
  kind, title, rows, columns, projectId, query, rowKey, actions, details, emptyTitle,
}: {
  kind: TrialQueueKind;
  title: string;
  rows: Row[];
  columns: TrialTableColumn<Row>[];
  projectId?: number;
  query: Record<string, string>;
  rowKey: (row: Row) => number;
  actions: (row: Row) => ReactNode;
  details?: (row: Row) => string[];
  emptyTitle: string;
}) {
  const field = (name: string) => trialQueueKey(kind, name);
  const pageSize = query[field("size")] ? getListPageSize(query[field("size")]) : trialDefaultPageSize;
  const search = query[field("q")] ?? "";
  const terms = normalize(search).split(/\s+/).filter(Boolean);
  const activeFilters = columns.filter((column) => query[field(column.key)]);
  const sort = columns.find((column) => column.key === query[field("sort")]);
  const descending = query[field("direction")] === "desc";
  const matching = rows.filter((row) => {
    if (terms.length) {
      const values = [...columns.map((column) => column.value(row)), ...(details?.(row) ?? [])].map(normalize);
      if (!terms.every((term) => values.some((value) => value.includes(term)))) return false;
    }
    return activeFilters.every((column) => {
      const value = column.value(row);
      const filter = normalize(query[field(column.key)]);
      return column.options || typeof value === "number" ? normalize(value) === filter : normalize(value).includes(filter);
    });
  });
  if (sort) {
    const sortValue = sort.sortValue ?? sort.value;
    matching.sort((a, b) => {
      const left = sortValue(a);
      const right = sortValue(b);
      const comparison = typeof left === "number" && typeof right === "number"
        ? left - right : collator.compare(String(left), String(right));
      return descending ? -comparison : comparison;
    });
  }
  const pages = Math.max(1, Math.ceil(matching.length / pageSize));
  const page = Math.min(Number(query[field("page")] ?? 1), pages);
  const offset = (page - 1) * pageSize;
  const visible = matching.slice(offset, offset + pageSize);
  const formId = kind + "-trial-filters";
  const titleId = kind + "-trial-title";
  const href = (changes: Record<string, string | number | undefined>) => workflowHref("/trial", projectId, { ...query, ...changes });
  const inputKeys = new Set([field("q"), field("size"), field("page"), ...columns.map(({ key }) => field(key))]);
  const filtered = activeFilters.length > 0 || Boolean(search);
  const reset = () => href(Object.fromEntries([...inputKeys].filter((key) => key !== field("size")).map((key) => [key, undefined])));

  return (
    <section className={`card ${styles.queue}`} aria-labelledby={titleId} id={kind === "binding" ? "binding-queue" : undefined} tabIndex={kind === "binding" ? -1 : undefined}>
      <div className={`card-header ${styles.header}`}>
        <div>
          <h2 id={titleId}>{title}</h2>
          <p className="small muted">{matching.length} 条记录{filtered && rows.length !== matching.length ? "，共 " + rows.length + " 条" : ""}</p>
        </div>
        <form className={styles.toolbar} id={formId} action="/trial">
          {projectId !== undefined && <input type="hidden" name="project" value={projectId} />}
          {Object.entries(query).filter(([key]) => !inputKeys.has(key)).map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)}
          <label className="field">
            <span className="label">搜索{title}</span>
            <input className="input" type="search" name={field("q")} key={search} defaultValue={search} placeholder="软件包、版本、批次或提交人" maxLength={120} />
          </label>
          <label className="field">
            <span className="label">每页条数</span>
            <select className="select" name={field("size")} key={pageSize} defaultValue={pageSize}>
              {LIST_PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
          <button type="submit" className="button button-primary"><Search size={14} />应用筛选</button>
          {filtered && <Link href={reset()} className="button button-secondary" prefetch={false}>清除筛选</Link>}
        </form>
      </div>
      <div className={`table-wrap ${styles.scroll}`} role="region" aria-label={title + "表格"} tabIndex={0}>
        <table className={`data-table ${styles.table}`}>
          <thead>
            <tr>
              {columns.map((column) => {
                const active = sort?.key === column.key;
                const Icon = !active ? ArrowUpDown : descending ? ArrowDown : ArrowUp;
                return <th key={column.key} scope="col" aria-sort={active ? descending ? "descending" : "ascending" : undefined}>
                  <Link className={styles.sort} href={href({
                    [field("sort")]: column.key,
                    [field("direction")]: active && !descending ? "desc" : undefined,
                    [field("page")]: undefined,
                  })} prefetch={false} aria-label={"按" + column.label + "排序"}>{column.label}<Icon size={13} aria-hidden /></Link>
                  {column.options
                    ? <select className="select" form={formId} name={field(column.key)} aria-label={"筛选" + column.label} defaultValue={query[field(column.key)] ?? ""} key={query[field(column.key)] ?? ""}>
                      <option value="">全部</option>
                      {column.options.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                    : <input className="input" type="search" form={formId} name={field(column.key)} aria-label={"筛选" + column.label} placeholder="全部" maxLength={120} defaultValue={query[field(column.key)] ?? ""} key={query[field(column.key)] ?? ""} />}
                </th>;
              })}
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => <tr key={rowKey(row)}>
              {columns.map((column) => <td key={column.key}>{column.cell ? column.cell(row) : column.value(row)}</td>)}
              <td className="cell-actions">{actions(row)}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
      {!visible.length && <EmptyState title={filtered ? "没有匹配的版本" : emptyTitle} />}
      {matching.length > 0 && <nav className={styles.pagination} aria-label={title + "分页"}>
        <span className="small muted">第 {page} / {pages} 页，显示 {offset + 1}–{offset + visible.length} 条</span>
        {page > 1 && <Link className="button button-secondary button-sm" href={href({ [field("page")]: page > 2 ? page - 1 : undefined })} prefetch={false}><ArrowLeft size={13} />上一页</Link>}
        {page < pages && <Link className="button button-secondary button-sm" href={href({ [field("page")]: page + 1 })} prefetch={false}>下一页<ArrowRight size={13} /></Link>}
      </nav>}
    </section>
  );
}
