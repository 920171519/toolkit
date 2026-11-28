import { readColumnFilters, type ColumnFilterField } from "./column-filters";
import { PACKAGE_STATUS_META } from "./constants";
import { PACKAGE_STATUSES } from "./domain-values";
import { DEFAULT_LIST_PAGE_SIZE, getListPageSize } from "./list-pagination";
import { safeOverviewReturnPath } from "./return-to";
import { workflowHref } from "./workflow-links";

export const TRACE_SORT_FIELDS = ["package", "version", "status", "submitted"] as const;
export const MAX_TRACE_TABS = 8;
export const DEFAULT_TRACE_SORT = "submitted";

type TraceSortField = typeof TRACE_SORT_FIELDS[number];

export const traceColumnFields = {
  package: { key: "package", label: "软件包名称或编码", kind: "text" },
  version: { key: "version", label: "版本号", kind: "text" },
  status: {
    key: "status",
    label: "版本状态",
    kind: "choices",
    options: PACKAGE_STATUSES.map((status) => ({ value: status, label: PACKAGE_STATUS_META[status].label })),
  },
  submitted: { key: "submitted", label: "提交时间", kind: "date" },
} satisfies Record<TraceSortField, ColumnFilterField>;

export type TraceListState = {
  query: string;
  packageId?: number;
  filters: Record<string, string>;
  sort: TraceSortField;
  direction: "asc" | "desc";
  page: number;
  pageSize: number;
  tabs: number[];
  returnTo?: string;
};

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 100) : "";
}

function positiveInteger(value: unknown) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

export function readTraceListState(params: Record<string, unknown>): TraceListState {
  const sort = TRACE_SORT_FIELDS.find((field) => field === params.sort) ?? DEFAULT_TRACE_SORT;
  const tabs = typeof params.tabs === "string" ? params.tabs.slice(0, 160).split(",")
    .map(positiveInteger)
    .filter((id): id is number => id !== undefined) : [];
  const statuses = (stringValue(params.f_status) ?? stringValue(params.status) ?? "").split(",");
  const filters = readColumnFilters({
    f_package: stringValue(params.f_package) ?? stringValue(params.pkg),
    f_package_mode: stringValue(params.f_package_mode),
    f_version: stringValue(params.f_version) ?? stringValue(params.ver),
    f_version_mode: stringValue(params.f_version_mode),
    f_status: PACKAGE_STATUSES.filter((status) => statuses.includes(status)).join(","),
    f_submitted_min: stringValue(params.f_submitted_min) ?? stringValue(params.from),
    f_submitted_max: stringValue(params.f_submitted_max) ?? stringValue(params.to),
  }, Object.values(traceColumnFields));
  return {
    query: textValue(params.q),
    packageId: positiveInteger(params.package),
    filters,
    sort,
    direction: params.dir === "asc" || params.dir === "desc" ? params.dir : sort === DEFAULT_TRACE_SORT ? "desc" : "asc",
    page: positiveInteger(params.page) ?? 1,
    pageSize: getListPageSize(typeof params.pageSize === "string" ? params.pageSize : undefined),
    tabs: [...new Set(tabs)].slice(0, MAX_TRACE_TABS),
    returnTo: safeOverviewReturnPath(params.returnTo),
  };
}

export function withTraceTab(state: TraceListState, id: number): TraceListState {
  return state.tabs.includes(id) ? state : { ...state, tabs: [...state.tabs, id].slice(-MAX_TRACE_TABS) };
}

export function traceListParams(state: TraceListState) {
  const defaultDirection = state.sort === DEFAULT_TRACE_SORT ? "desc" : "asc";
  return {
    q: state.query || undefined,
    package: state.packageId === undefined ? undefined : String(state.packageId),
    ...state.filters,
    sort: state.sort === DEFAULT_TRACE_SORT ? undefined : state.sort,
    dir: state.direction === defaultDirection ? undefined : state.direction,
    page: state.page > 1 ? String(state.page) : undefined,
    pageSize: state.pageSize === DEFAULT_LIST_PAGE_SIZE ? undefined : String(state.pageSize),
    tabs: state.tabs.length > 0 ? state.tabs.join(",") : undefined,
    returnTo: state.returnTo,
  };
}

export function traceHref(state: TraceListState, projectId?: number, versionId?: number) {
  return workflowHref(versionId ? `/versions/${versionId}` : "/versions", projectId, traceListParams(state));
}
