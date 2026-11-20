import { PACKAGE_STATUSES, type PackageStatus } from "./constants";
import { DEFAULT_LIST_PAGE_SIZE, getListPageSize } from "./list-pagination";
import { workflowHref } from "./workflow-links";

export const TRACE_SORT_FIELDS = ["package", "version", "status", "submitted"] as const;
export const MAX_TRACE_TABS = 8;
export const DEFAULT_TRACE_SORT = "submitted";

type TraceSortField = typeof TRACE_SORT_FIELDS[number];

export type TraceListState = {
  query: string;
  packageId?: number;
  packageFilter: string;
  versionFilter: string;
  status?: PackageStatus;
  submittedFrom?: string;
  submittedThrough?: string;
  sort: TraceSortField;
  direction: "asc" | "desc";
  page: number;
  pageSize: number;
  tabs: number[];
};

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 100) : "";
}

function positiveInteger(value: unknown) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function dateValue(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : undefined;
}

export function readTraceListState(params: Record<string, unknown>): TraceListState {
  const sort = TRACE_SORT_FIELDS.find((field) => field === params.sort) ?? DEFAULT_TRACE_SORT;
  const tabs = typeof params.tabs === "string" ? params.tabs.slice(0, 160).split(",")
    .map(positiveInteger)
    .filter((id): id is number => id !== undefined) : [];
  return {
    query: textValue(params.q),
    packageId: positiveInteger(params.package),
    packageFilter: textValue(params.pkg),
    versionFilter: textValue(params.ver),
    status: PACKAGE_STATUSES.find((status) => status === params.status),
    submittedFrom: dateValue(params.from),
    submittedThrough: dateValue(params.to),
    sort,
    direction: params.dir === "asc" || params.dir === "desc" ? params.dir : sort === DEFAULT_TRACE_SORT ? "desc" : "asc",
    page: positiveInteger(params.page) ?? 1,
    pageSize: getListPageSize(typeof params.pageSize === "string" ? params.pageSize : undefined),
    tabs: [...new Set(tabs)].slice(0, MAX_TRACE_TABS),
  };
}

export function withTraceTab(state: TraceListState, id: number): TraceListState {
  return state.tabs.includes(id) ? state : { ...state, tabs: [...state.tabs, id].slice(-MAX_TRACE_TABS) };
}

export function traceListParams(state: TraceListState) {
  const defaultDirection = state.sort === DEFAULT_TRACE_SORT ? "desc" : "asc";
  return {
    q: state.query || undefined,
    package: state.packageId,
    pkg: state.packageFilter || undefined,
    ver: state.versionFilter || undefined,
    status: state.status,
    from: state.submittedFrom,
    to: state.submittedThrough,
    sort: state.sort === DEFAULT_TRACE_SORT ? undefined : state.sort,
    dir: state.direction === defaultDirection ? undefined : state.direction,
    page: state.page > 1 ? state.page : undefined,
    pageSize: state.pageSize === DEFAULT_LIST_PAGE_SIZE ? undefined : state.pageSize,
    tabs: state.tabs.length > 0 ? state.tabs.join(",") : undefined,
  };
}

export function traceHref(state: TraceListState, projectId?: number, versionId?: number) {
  return workflowHref(versionId ? `/versions/${versionId}` : "/versions", projectId, traceListParams(state));
}
