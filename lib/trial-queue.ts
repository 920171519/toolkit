import { columnFilterKeys, readColumnFilters, type ColumnFilterField } from "./column-filters";
import { LIST_PAGE_SIZES } from "./list-pagination";

export const trialQueueColumns = {
  release: ["package", "version", "project", "batch", "submitter", "status"],
  binding: ["package", "version", "project", "batch", "submitter", "status", "form", "progress", "pending"],
} as const;

export type TrialQueueKind = keyof typeof trialQueueColumns;
export type TrialColumnKey = (typeof trialQueueColumns)[TrialQueueKind][number];
export type TrialSearchParams = Record<string, string | string[] | undefined>;

export const trialDefaultPageSize = 10;

export const trialReleaseStatuses = {
  READY: "待发试制",
  RISK: "风险发布",
};

export const trialBindingStatuses = {
  PENDING: "待推送绑定",
  PUSHED: "绑定中",
  SKIPPED: "跳过绑定",
  RISK: "风险发布",
  OVERDUE: "已超期",
};

export function trialQueueKey(kind: TrialQueueKind, field: string) {
  return kind + "_" + field;
}

export function trialColumnFilter(kind: TrialQueueKind, column: TrialColumnKey, label: string): ColumnFilterField {
  const key = trialQueueKey(kind, column);
  if (column === "status") {
    const statuses = kind === "release" ? trialReleaseStatuses : trialBindingStatuses;
    return { key, label, kind: "choices", options: Object.entries(statuses).map(([value, label]) => ({ value, label })) };
  }
  if (column === "project") return { key, label, kind: "choices" };
  if (column === "pending") return { key, label, kind: "number" };
  return { key, label, kind: "text" };
}

export function trialLegacyFilter(field: ColumnFilterField, label: string): ColumnFilterField {
  return { key: field.key + "_text", label: label + "关键词", kind: "text" };
}

function legacyFilterParams(kind: TrialQueueKind, field: ColumnFilterField, value: string): TrialSearchParams {
  const [key, max] = columnFilterKeys(field);
  if (field.kind === "text") return { [key]: value };
  const normalized = value.normalize("NFKC");
  if (field.key === "binding_status" && (normalized === "待转正" || normalized === "PENDING_FORMAL")) return {};
  if (field.kind === "number") {
    const number = Number(normalized);
    if (Number.isSafeInteger(number) && number >= 0 && String(number) === normalized) {
      return { [key]: normalized, [max]: normalized };
    }
  }
  const status = field.options?.find((option) => option.label === normalized);
  if (status) return { [key]: status.value };

  const [textKey, mode] = columnFilterKeys(trialLegacyFilter(field, ""));
  const exact = field.kind === "number" || (kind === "release" && field.key === "release_status");
  return { [textKey]: value, [mode]: exact ? "exact" : undefined };
}

export function trialQueueParams(search: TrialSearchParams): Record<string, string> {
  const result: Record<string, string> = {};
  for (const kind of ["release", "binding"] as const) {
    const columns: readonly string[] = trialQueueColumns[kind];
    const queryKey = trialQueueKey(kind, "q");
    const query = search[queryKey];
    if (typeof query === "string" && query.trim()) result[queryKey] = query.trim().slice(0, 120);

    for (const column of trialQueueColumns[kind]) {
      const field = trialColumnFilter(kind, column, "");
      const fields = field.kind === "text" ? [field] : [field, trialLegacyFilter(field, "")];
      const current = readColumnFilters(search, fields);
      const legacy = search[field.key];
      const filter = Object.keys(current).length > 0 || typeof legacy !== "string" || !legacy.trim()
        ? current
        : readColumnFilters(legacyFilterParams(kind, field, legacy.trim().slice(0, 120)), fields);
      Object.assign(result, filter);
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
  if (result.f_binding_status) {
    const remaining = result.f_binding_status.split(",").filter((value) => value !== "PENDING_FORMAL");
    if (remaining.length > 0) result.f_binding_status = remaining.join(",");
    else delete result.f_binding_status;
  }
  return result;
}
