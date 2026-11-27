import { DEFAULT_LIST_PAGE_SIZE, getListPageSize, readListPage } from "./list-pagination";
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

export function getWorkflowListState(params: Record<string, string | string[] | undefined>) {
  const page = readListPage(params.page);
  const pageSize = getListPageSize(params.pageSize);
  return {
    q: getWorkflowSearch(params.q) || undefined,
    page: page > 1 ? page : undefined,
    pageSize: pageSize !== DEFAULT_LIST_PAGE_SIZE ? pageSize : undefined,
    returnTo: safeOverviewReturnPath(params.returnTo),
  };
}
