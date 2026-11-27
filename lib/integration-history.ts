import { readColumnFilters, type ColumnFilterField } from "./column-filters";
import { BATCH_STATUS_META, CONCLUSION_META } from "./constants";
import { getListPageSize, readListPage } from "./list-pagination";

export const historyStatuses = ["COMPLETED", "TERMINATED"] as const;

export const historyFields = {
  batch: { key: "batch", label: "批次号", kind: "text" },
  title: { key: "title", label: "批次标题", kind: "text" },
  project: { key: "project", label: "项目", kind: "choices" },
  status: { key: "status", label: "状态", kind: "choices", options: historyStatuses.map((value) => ({ value, label: BATCH_STATUS_META[value].label })) },
  items: { key: "items", label: "配套包数", kind: "number" },
  changed: { key: "changed", label: "变更包数", kind: "number" },
  conclusion: { key: "conclusion", label: "结论", kind: "choices", options: [
    ...Object.entries(CONCLUSION_META).map(([value, meta]) => ({ value, label: meta.label })),
    { value: "NONE", label: "无测试结论" },
  ] },
  date: { key: "date", label: "时间", kind: "date" },
} satisfies Record<string, ColumnFilterField>;

export function readIntegrationHistory(params: Record<string, string | string[] | undefined>) {
  const filters = readColumnFilters(params, Object.values(historyFields));
  const page = readListPage(params.page);
  const pageSize = getListPageSize(params.pageSize);
  const open = params.history === "1" || page > 1 || Object.keys(filters).length > 0;
  return { filters, page, pageSize, open };
}

export function integrationHistoryParams(state: ReturnType<typeof readIntegrationHistory>) {
  return {
    ...state.filters,
    history: "1",
    page: state.page > 1 ? String(state.page) : undefined,
    pageSize: String(state.pageSize),
  };
}
