"use client";

import { LIST_PAGE_SIZES } from "@/lib/list-pagination";

export function DirectoryPageSize({ path, params, pageSize, pageParam = "page", sizeParam = "pageSize", hash = "" }: {
  path: string;
  params: Record<string, string | undefined>;
  pageSize: number;
  pageParam?: string;
  sizeParam?: string;
  hash?: string;
}) {
  return (
    <form action={path + hash} method="get" className="toolbar">
      {Object.entries(params).map(([name, value]) => value && name !== pageParam && name !== sizeParam
        ? <input key={name} type="hidden" name={name} value={value} /> : null)}
      <label className="toolbar small muted">
        每页条数
        <select className="select select-sm" name={sizeParam} key={pageSize} defaultValue={pageSize} onChange={(event) => event.currentTarget.form?.requestSubmit()}>
          {LIST_PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
        </select>
      </label>
      <noscript><button type="submit" className="button button-secondary button-sm">应用</button></noscript>
    </form>
  );
}
