import Link from "next/link";
import { ArrowDown, ArrowDownUp, ArrowUp } from "lucide-react";
import type { ColumnFilterField } from "@/lib/column-filters";
import { directoryHref } from "@/lib/settings-directory";
import { ColumnFilterPopover } from "./column-filter-popover";
import styles from "./column-filter-header.module.css";

export function ColumnFilterHeader({
  label, path, params, fields, numeric, sortKey, sortLabel, sortParam = "sort", orderParam = "order", pageParam = "page", hash = "", onFilterChange,
}: {
  label: string;
  path: string;
  params: Record<string, string | undefined>;
  fields: ColumnFilterField[];
  numeric?: boolean;
  sortKey?: string;
  sortLabel?: string;
  sortParam?: string;
  orderParam?: string;
  pageParam?: string;
  hash?: string;
  onFilterChange?: (filters: Record<string, string>) => void;
}) {
  const selected = Boolean(sortKey && sortKey === params[sortParam]);
  const ascending = selected && params[orderParam] !== "desc";
  const Arrow = selected ? ascending ? ArrowUp : ArrowDown : ArrowDownUp;

  return (
    <th scope="col" className={numeric ? styles.numeric : undefined} aria-sort={selected ? ascending ? "ascending" : "descending" : undefined}>
      <div className={styles.header}>
        {sortKey ? (
          <Link
            className={styles.sort}
            href={directoryHref(path, { ...params, [sortParam]: sortKey, [orderParam]: ascending ? "desc" : "asc", [pageParam]: undefined }) + hash}
            prefetch={false}
            aria-label={sortLabel}
          >
            {label}<Arrow size={12} aria-hidden="true" />
          </Link>
        ) : <span>{label}</span>}
        <ColumnFilterPopover label={label} path={path} params={params} fields={fields}
          pageParam={pageParam} hash={hash} onFilterChange={onFilterChange} />
      </div>
    </th>
  );
}
