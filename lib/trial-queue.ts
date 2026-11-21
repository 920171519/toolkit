import { LIST_PAGE_SIZES } from "./list-pagination";

export const trialQueueColumns = {
  release: ["package", "version", "project", "batch", "submitter", "status"],
  binding: ["package", "version", "project", "batch", "submitter", "status", "form", "progress", "pending"],
} as const;

export type TrialQueueKind = keyof typeof trialQueueColumns;
export type TrialColumnKey = (typeof trialQueueColumns)[TrialQueueKind][number];
export type TrialSearchParams = Record<string, string | string[] | undefined>;

export const trialDefaultPageSize = 10;

export function trialQueueKey(kind: TrialQueueKind, field: string) {
  return kind + "_" + field;
}

export function trialQueueFilterKeys(kind: TrialQueueKind) {
  return ["q", "size", ...trialQueueColumns[kind]].map((field) => trialQueueKey(kind, field));
}

export function trialQueueParams(search: TrialSearchParams): Record<string, string> {
  const result: Record<string, string> = {};
  for (const kind of ["release", "binding"] as const) {
    const columns: readonly string[] = trialQueueColumns[kind];
    for (const field of ["q", ...columns]) {
      const key = trialQueueKey(kind, field);
      const value = search[key];
      if (typeof value === "string" && value.trim()) result[key] = value.slice(0, 120).trim();
    }
    const sizeKey = trialQueueKey(kind, "size");
    if (typeof search[sizeKey] === "string") {
      const pageSize = LIST_PAGE_SIZES.find((size) => size === Number(search[sizeKey]));
      if (pageSize && pageSize !== trialDefaultPageSize) result[sizeKey] = String(pageSize);
    }
    const pageKey = trialQueueKey(kind, "page");
    const pageNumber = Number(search[pageKey]);
    if (typeof search[pageKey] === "string" && Number.isSafeInteger(pageNumber) && pageNumber > 1) {
      result[pageKey] = String(pageNumber);
    }
    const sortKey = trialQueueKey(kind, "sort");
    const sort = search[sortKey];
    if (typeof sort === "string" && columns.includes(sort)) {
      result[sortKey] = sort;
      const directionKey = trialQueueKey(kind, "direction");
      if (search[directionKey] === "desc") result[directionKey] = "desc";
    }
  }
  return result;
}
