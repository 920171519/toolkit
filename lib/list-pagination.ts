export const LIST_PAGE_SIZES = [10, 25, 50] as const;
export const DEFAULT_LIST_PAGE_SIZE = 25;

export function getListPageSize(
  value: string | string[] | null | undefined,
  defaultSize: typeof LIST_PAGE_SIZES[number] = DEFAULT_LIST_PAGE_SIZE,
) {
  const requested = typeof value === "string" ? Number(value) : NaN;
  return LIST_PAGE_SIZES.find((size) => size === requested) ?? defaultSize;
}

export function readListPage(value: unknown) {
  const requested = typeof value === "string" ? Number(value) : 1;
  return Number.isSafeInteger(requested) && requested > 0 ? requested : 1;
}

// Callers provide the row count after filtering and a page parsed by their input contract.
export function getPageWindow(total: number, pageSize: number, requestedPage: number) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(pages, Math.max(1, requestedPage));
  const offset = (current - 1) * pageSize;
  return { current, pages, offset, end: offset + pageSize };
}
