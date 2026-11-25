import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { ColumnFilterHeader } from "@/components/column-filter-header";
import { DirectoryPageSize } from "@/components/directory-page-size";
import { DirectoryFilterBar } from "@/components/settings-directory";
import { EmptyState } from "@/components/ui";
import { filterOptions, matchesChoiceFilter, matchesNumberFilter, matchesTextFilter, type ColumnFilterOption } from "@/lib/column-filters";
import { getListPageSize } from "@/lib/list-pagination";
import { workflowHref } from "@/lib/workflow-links";
import { trialColumnFilter, trialDefaultPageSize, trialLegacyFilter, trialQueueKey, type TrialColumnKey, type TrialQueueKind } from "@/lib/trial-queue";
import styles from "./trial-queue-table.module.css";
import { TrialBindingFocus } from "./trial-binding-focus";

export type TrialTableColumn<Row> = {
  key: TrialColumnKey;
  label: string;
  value: (row: Row) => string | number;
  sortValue?: (row: Row) => string | number;
  cell?: (row: Row) => ReactNode;
  filterValues?: (row: Row) => string[];
  choices?: (row: Row) => ColumnFilterOption[];
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
  const columnFilters = columns.map((column) => {
    const filter = trialColumnFilter(kind, column.key, column.label);
    if (column.choices && !filter.options) {
      filter.options = filterOptions(rows.flatMap(column.choices));
    }
    const legacy = trialLegacyFilter(filter, column.label);
    const hasLegacy = Boolean(query[`f_${legacy.key}`]);
    return { column, filter, fields: hasLegacy ? [filter, legacy] : [filter], legacy };
  });
  const sort = columns.find((column) => column.key === query[field("sort")]);
  const descending = query[field("direction")] === "desc";
  const matching = rows.filter((row) => {
    if (terms.length) {
      const values = [...columns.map((column) => column.value(row)), ...(details?.(row) ?? [])].map(normalize);
      if (!terms.every((term) => values.some((value) => value.includes(term)))) return false;
    }
    return columnFilters.every(({ column, filter, legacy }) => {
      const value = column.value(row);
      if (!matchesTextFilter(query, legacy.key, String(value))) return false;
      if (filter.kind === "choices") {
        return matchesChoiceFilter(query, filter.key, column.choices?.(row).map((option) => option.value) ?? []);
      }
      if (filter.kind === "number" && typeof value === "number") return matchesNumberFilter(query, filter.key, value);
      return (column.filterValues?.(row) ?? [String(value)]).some((candidate) => matchesTextFilter(query, filter.key, candidate));
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
  const titleId = kind + "-trial-title";
  const hash = kind === "binding" ? "#binding-queue" : "";
  const href = (changes: Record<string, string | number | undefined>) => workflowHref("/trial", projectId, { ...query, ...changes }) + hash;
  const filterPrefix = `f_${kind}_`;
  const filtered = Object.keys(query).some((key) => key.startsWith(filterPrefix)) || Boolean(search);
  const resetFilters = Object.fromEntries(Object.keys(query)
    .filter((key) => key.startsWith(filterPrefix) || key === field("q") || key === field("page"))
    .map((key) => [key, undefined]));
  const listParams = { project: projectId?.toString(), ...query };

  return (
    <section className={`card ${styles.queue}`} aria-labelledby={titleId} id={kind === "binding" ? "binding-queue" : undefined} tabIndex={kind === "binding" ? -1 : undefined}>
      {kind === "binding" && <TrialBindingFocus />}
      <div className={`card-header ${styles.header}`}>
        <div>
          <h2 id={titleId}>{title}</h2>
          <p className={styles.count} role="status">{matching.length} 条记录{filtered && rows.length !== matching.length ? "，共 " + rows.length + " 条" : ""}</p>
        </div>
        <DirectoryFilterBar path="/trial" params={listParams} filterPrefix={filterPrefix} searchParam={field("q")} pageParam={field("page")} hash={hash} />
      </div>
      <div className={`table-wrap ${styles.scroll}`} role="region" aria-label={title + "表格"} tabIndex={0}>
        <table className={`data-table ${styles.table}`}>
          <thead>
            <tr>
              {columnFilters.map(({ column, fields }) => (
                <ColumnFilterHeader
                  key={column.key}
                  label={column.label}
                  path="/trial"
                  params={listParams}
                  fields={fields}
                  sortKey={column.key}
                  sortLabel={"按" + column.label + "排序"}
                  sortParam={field("sort")}
                  orderParam={field("direction")}
                  pageParam={field("page")}
                  hash={hash}
                />
              ))}
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
      {!visible.length && <EmptyState title={filtered ? "没有匹配的版本" : emptyTitle}
        action={filtered ? <Link className="button button-secondary button-sm" href={href(resetFilters)} prefetch={false}>
          清除本队列筛选
        </Link> : undefined} />}
      <nav className={styles.pagination} aria-label={title + "分页"}>
        <DirectoryPageSize path="/trial" params={listParams} pageSize={pageSize} pageParam={field("page")} sizeParam={field("size")} hash={hash} />
        <span className="small muted">第 {page} / {pages} 页{matching.length > 0 && "，显示 " + (offset + 1) + "–" + (offset + visible.length) + " 条"}</span>
        {page > 1 && <Link className="button button-secondary button-sm" href={href({ [field("page")]: page > 2 ? page - 1 : undefined })} prefetch={false}><ArrowLeft size={13} />上一页</Link>}
        {page < pages && <Link className="button button-secondary button-sm" href={href({ [field("page")]: page + 1 })} prefetch={false}>下一页<ArrowRight size={13} /></Link>}
      </nav>
    </section>
  );
}
