import type { ReactNode } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { getPageWindow } from "@/lib/list-pagination";
import { directoryHref, directoryValue } from "@/lib/settings-directory";
import { PageLinks } from "./page-links";

export function matchesSearch(search: string, ...values: Array<string | null | undefined>) {
  return !search || values.some((value) => value?.toLowerCase().includes(search.toLowerCase()));
}

export function settingsPage<T>(items: T[], value: string | string[] | undefined, pageSize = 20) {
  const requested = Math.floor(Number(directoryValue(value)) || 1);
  const { current: page, pages: pageCount, offset, end } = getPageWindow(items.length, pageSize, requested);
  return { items: items.slice(offset, end), page, pageCount, total: items.length };
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
  range: string;
}) {
  const href = (nextPage: number) => directoryHref(action, { ...filters, page: String(nextPage) });

  return (
    <nav className="settings-pagination" aria-label="列表分页">
      <span className="small muted">{range}</span>
      {pageCount > 1 && <div className="toolbar">
        <PageLinks page={page} pages={pageCount} href={href} icons="chevrons">
          <span className="small muted">第 {page} 页 / 共 {pageCount} 页</span>
        </PageLinks>
      </div>}
    </nav>
  );
}
