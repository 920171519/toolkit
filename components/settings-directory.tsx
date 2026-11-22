import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowDown, ArrowDownUp, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import { LIST_PAGE_SIZES } from "@/lib/list-pagination";
import { directoryHref } from "@/lib/settings-directory";
import styles from "./settings-directory.module.css";

export function DirectoryFilters({ path, query, placeholder, params, children, filtered, pageSize }: {
  path: string;
  query: string;
  placeholder: string;
  params: Record<string, string | undefined>;
  children?: ReactNode;
  filtered: boolean;
  pageSize: number;
}) {
  return (
    <form action={path} method="get" className={styles.filters} role="search" aria-label="筛选列表">
      <label className={`field ${styles.search}`}>
        <span className="label">搜索</span>
        <input key={query} className="input" type="search" name="q" defaultValue={query} placeholder={placeholder} maxLength={120} />
      </label>
      {children}
      {params.sort && <input type="hidden" name="sort" value={params.sort} />}
      {params.order && <input type="hidden" name="order" value={params.order} />}
      <label className="field">
        <span className="label">每页条数</span>
        <select key={pageSize} className="select" name="pageSize" defaultValue={pageSize}>
          {LIST_PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
        </select>
      </label>
      <div className="toolbar">
        <button type="submit" className="button button-secondary">筛选</button>
        {filtered && <Link href={directoryHref(path, { sort: params.sort, order: params.order, pageSize: String(pageSize) })} prefetch={false} className="button button-ghost">清除筛选</Link>}
      </div>
    </form>
  );
}

export function DirectorySort({ column, label, path, params, numeric }: {
  column: string;
  label: string;
  path: string;
  params: Record<string, string | undefined>;
  numeric?: boolean;
}) {
  const selected = column === params.sort;
  const ascending = selected && params.order !== "desc";
  const Arrow = selected ? ascending ? ArrowUp : ArrowDown : ArrowDownUp;
  return (
    <th scope="col" className={numeric ? styles.number : undefined} aria-sort={selected ? ascending ? "ascending" : "descending" : undefined}>
      <Link
        className={styles.sort}
        href={directoryHref(path, { ...params, sort: column, order: ascending ? "desc" : "asc", page: undefined })}
        prefetch={false}
      >
        {label}<Arrow size={13} aria-hidden="true" />
      </Link>
    </th>
  );
}

export function DirectoryPagination({ path, params, page, pages, total, unit }: {
  path: string;
  params: Record<string, string | undefined>;
  page: number;
  pages: number;
  total: number;
  unit: string;
}) {
  const href = (nextPage: number) => directoryHref(path, { ...params, page: String(nextPage) });
  return (
    <nav className={styles.pagination} aria-label="列表分页">
      <span className={styles.meta}>共 {total} {unit}</span>
      {pages > 1 && <div className="toolbar">
        {page > 1 && <Link href={href(page - 1)} prefetch={false} className="button button-secondary button-sm"><ChevronLeft size={14} aria-hidden="true" />上一页</Link>}
        <span className="small muted">第 {page} 页 / 共 {pages} 页</span>
        {page < pages && <Link href={href(page + 1)} prefetch={false} className="button button-secondary button-sm">下一页<ChevronRight size={14} aria-hidden="true" /></Link>}
      </div>}
    </nav>
  );
}
