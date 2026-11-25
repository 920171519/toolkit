import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { directoryHref } from "@/lib/settings-directory";
import { DirectoryPageSize } from "./directory-page-size";
import styles from "./settings-directory.module.css";

export function DirectoryFilterBar({ path, params, filterPrefix = "f_", searchParam = "q", pageParam = "page", hash = "" }: {
  path: string;
  params: Record<string, string | undefined>;
  filterPrefix?: string;
  searchParam?: string;
  pageParam?: string;
  hash?: string;
}) {
  const query = params[searchParam];
  const active = Object.entries(params).some(([key, value]) => key.startsWith(filterPrefix) && value);
  if (!active && !query) return null;
  const clear = Object.fromEntries(Object.entries(params).filter(([key]) => !key.startsWith(filterPrefix) && key !== searchParam && key !== pageParam));
  return (
    <div className={styles.filterSummary}>
      {query && (
        <Link
          className={styles.legacySearch}
          href={directoryHref(path, { ...params, [searchParam]: undefined, [pageParam]: undefined }) + hash}
          aria-label={`清除搜索条件 ${query}`}
          prefetch={false}
          scroll={false}
        >
          搜索 {query} ×
        </Link>
      )}
      <Link href={directoryHref(path, clear) + hash} className="button button-ghost button-sm" prefetch={false} scroll={false}>清除全部筛选</Link>
    </div>
  );
}

export function DirectoryPagination({ path, params, page, pages, total, unit, pageSize, label = "列表分页" }: {
  path: string;
  params: Record<string, string | undefined>;
  page: number;
  pages: number;
  total: number;
  unit: string;
  pageSize: number;
  label?: string;
}) {
  const href = (nextPage: number) => directoryHref(path, { ...params, page: String(nextPage) });
  return (
    <div className={styles.pagination}>
      <span className={styles.meta} role="status">共 {total} {unit}</span>
      <div className={styles.paginationControls}>
        <DirectoryPageSize path={path} params={params} pageSize={pageSize} />
        {pages > 1 && <nav aria-label={label} className={styles.pageNavigation}>
          {page > 1 && <Link href={href(page - 1)} prefetch={false} className="button button-secondary button-sm"><ChevronLeft size={14} aria-hidden="true" />上一页</Link>}
          <span className="small muted">第 {page} 页 / 共 {pages} 页</span>
          {page < pages && <Link href={href(page + 1)} prefetch={false} className="button button-secondary button-sm">下一页<ChevronRight size={14} aria-hidden="true" /></Link>}
        </nav>}
      </div>
    </div>
  );
}
