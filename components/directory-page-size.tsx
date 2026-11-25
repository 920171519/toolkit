"use client";

import { PageSizeSelect } from "@/components/page-size-select";

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
      <PageSizeSelect name={sizeParam} key={pageSize} defaultValue={pageSize} onChange={(event) => event.currentTarget.form?.requestSubmit()} />
      <noscript><button type="submit" className="button button-secondary button-sm">应用</button></noscript>
    </form>
  );
}
