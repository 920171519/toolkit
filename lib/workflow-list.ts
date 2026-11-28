import { DEFAULT_LIST_PAGE_SIZE, getListPageSize, readListPage } from "./list-pagination";
import { safeOverviewReturnPath } from "./return-to";
import { readListSearchQuery } from "./search-text";

export function workflowSearchMatcher(query: string) {
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return (...values: Array<string | null>) => {
    const text = values.join(" ").toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  };
}

export function workflowListParams({ q, page, pageSize }: { q: string; page: number; pageSize: number }) {
  return {
    q: q || undefined,
    page: page > 1 ? page : undefined,
    pageSize: pageSize !== DEFAULT_LIST_PAGE_SIZE ? pageSize : undefined,
  };
}

export function getWorkflowListState(params: Record<string, string | string[] | undefined>) {
  return {
    ...workflowListParams({
      q: readListSearchQuery(params.q),
      page: readListPage(params.page),
      pageSize: getListPageSize(params.pageSize),
    }),
    returnTo: safeOverviewReturnPath(params.returnTo),
  };
}
