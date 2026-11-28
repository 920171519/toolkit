import { Search } from "lucide-react";
import type { ReactNode } from "react";
import { PageSizeSelect } from "@/components/page-size-select";
import { LIST_SEARCH_QUERY_MAX_LENGTH } from "@/lib/search-text";
import { PageLinks } from "./page-links";
import styles from "./workflow-queue.module.css";

export function WorkflowListSearch({ action, label, query, pageSize, fields, children, showPageSize = true }: {
  action: string;
  label: string;
  query: string;
  pageSize: number;
  showPageSize?: boolean;
  fields?: Record<string, string | number | undefined>;
  children?: ReactNode;
}) {
  return (
    <form action={action} method="get" role="search" aria-label={label} className={styles.listSearch}>
      {Object.entries(fields ?? {}).map(([name, value]) => value === undefined ? null
        : <input key={name} type="hidden" name={name} value={value} />)}
      <input className="input input-sm" key={query} type="search" name="q" defaultValue={query} maxLength={LIST_SEARCH_QUERY_MAX_LENGTH} placeholder={label} aria-label={label} />
      {children}
      {showPageSize ? <PageSizeSelect key={pageSize} name="pageSize" defaultValue={pageSize} />
        : <input type="hidden" name="pageSize" value={pageSize} />}
      <button className="button button-secondary button-sm" type="submit"><Search size={14} aria-hidden="true" />搜索</button>
    </form>
  );
}

export function WorkflowListPagination({ label, current, pages, href }: {
  label: string;
  current: number;
  pages: number;
  href: (page: number) => string;
}) {
  if (pages <= 1) return null;
  return (
    <nav className={styles.pagination} aria-label={label}>
      <PageLinks page={current} pages={pages} href={href}>
        <span>第 {current} / {pages} 页</span>
      </PageLinks>
    </nav>
  );
}
