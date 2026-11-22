import Link from "next/link";
import { Search } from "lucide-react";
import type { ReactNode } from "react";
import { LIST_PAGE_SIZES } from "@/lib/list-pagination";
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
      <input className="input input-sm" key={query} type="search" name="q" defaultValue={query} maxLength={100} placeholder={label} aria-label={label} />
      {children}
      {showPageSize ? <label className={styles.pageSize}>
        <span>每页</span>
        <select key={pageSize} className="input input-sm" name="pageSize" defaultValue={pageSize} aria-label="每页条数">
          {LIST_PAGE_SIZES.map((size) => <option key={size} value={size}>{size} 条</option>)}
        </select>
      </label> : <input type="hidden" name="pageSize" value={pageSize} />}
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
      {current > 1 && <Link href={href(current - 1)} prefetch={false} className="button button-secondary button-sm">上一页</Link>}
      <span>第 {current} / {pages} 页</span>
      {current < pages && <Link href={href(current + 1)} prefetch={false} className="button button-secondary button-sm">下一页</Link>}
    </nav>
  );
}
