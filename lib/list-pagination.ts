export const LIST_PAGE_SIZES = [10, 25, 50] as const;
export const DEFAULT_LIST_PAGE_SIZE = 25;

export function getListPageSize(value: string | string[] | null | undefined) {
  const requested = typeof value === "string" ? Number(value) : NaN;
  return LIST_PAGE_SIZES.find((size) => size === requested) ?? DEFAULT_LIST_PAGE_SIZE;
}
