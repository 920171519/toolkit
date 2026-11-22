import { DEFAULT_LIST_PAGE_SIZE, getListPageSize } from "./list-pagination";
import { safeOverviewReturnPath } from "./return-to";

export function getWorkflowSearch(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 100) : "";
}

export function workflowSearchMatcher(query: string) {
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return (...values: Array<string | null>) => {
    const text = values.join(" ").toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  };
}

export function getWorkflowPage(total: number, pageSize: number, value: unknown) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const requestedPage = typeof value === "string" ? Number(value) : 1;
  const current = Number.isSafeInteger(requestedPage) ? Math.min(pages, Math.max(1, requestedPage)) : 1;
  const offset = (current - 1) * pageSize;
  return { current, pages, offset, end: offset + pageSize };
}

export function getWorkflowListState(params: Record<string, string | string[] | undefined>) {
  const page = typeof params.page === "string" ? Number(params.page) : 1;
  const pageSize = getListPageSize(params.pageSize);
  return {
    q: getWorkflowSearch(params.q) || undefined,
    page: Number.isSafeInteger(page) && page > 1 ? page : undefined,
    pageSize: pageSize !== DEFAULT_LIST_PAGE_SIZE ? pageSize : undefined,
    returnTo: safeOverviewReturnPath(params.returnTo),
  };
}
