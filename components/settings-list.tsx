import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";

export function searchValue(value: string | string[] | undefined) {
  return typeof value === "string" ? value.trim().slice(0, 120) : "";
}

export function matchesSearch(search: string, ...values: Array<string | null | undefined>) {
  return !search || values.some((value) => value?.toLowerCase().includes(search.toLowerCase()));
}

export function settingsPage<T>(items: T[], value: string | string[] | undefined, pageSize = 20) {
  const requested = Number(searchValue(value)) || 1;
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(pageCount, Math.max(1, Math.floor(requested)));
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), page, pageCount, total: items.length };
}

export function SettingsFilters({ action, search, placeholder, children, hasFilters, clearHref = action }: {
  action: string;
  search: string;
  placeholder: string;
  children?: ReactNode;
  hasFilters: boolean;
  clearHref?: string;
}) {
  return (
    <form action={action} method="get" className="settings-filters" role="search" aria-label="筛选列表">
      <label className="field settings-filter-search">
        <span className="sr-only">搜索</span>
        <span className="input package-search-input">
          <Search size={16} aria-hidden="true" />
          <input key={search} type="search" name="q" defaultValue={search} placeholder={placeholder} maxLength={120} />
        </span>
      </label>
      {children}
      <div className="toolbar settings-filter-actions">
        <button type="submit" className="button button-secondary">筛选</button>
        {hasFilters && <Link href={clearHref} className="button button-ghost" prefetch={false}>清除筛选</Link>}
      </div>
    </form>
  );
}

export function SettingsPagination({ action, page, pageCount, filters, range }: {
  action: string;
  page: number;
  pageCount: number;
  filters: Record<string, string>;
  range?: string;
}) {
  if (pageCount <= 1 && !range) return null;

  function href(nextPage: number) {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => Boolean(value)));
    query.set("page", String(nextPage));
    return `${action}?${query}`;
  }

  return (
    <nav className="settings-pagination" aria-label="列表分页">
      <span className="small muted">{range ?? `第 ${page} 页 / 共 ${pageCount} 页`}</span>
      {pageCount > 1 && <div className="toolbar">
        {page > 1 && <Link href={href(page - 1)} className="button button-secondary button-sm" prefetch={false}><ChevronLeft size={14} aria-hidden="true" />上一页</Link>}
        {range && <span className="small muted">第 {page} 页 / 共 {pageCount} 页</span>}
        {page < pageCount && <Link href={href(page + 1)} className="button button-secondary button-sm" prefetch={false}>下一页<ChevronRight size={14} aria-hidden="true" /></Link>}
      </div>}
    </nav>
  );
}
