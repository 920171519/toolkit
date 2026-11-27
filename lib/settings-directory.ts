import { columnFilterKeys, type ColumnFilterField } from "./column-filters";
import { getPageWindow, readListPage } from "./list-pagination";

export type DirectoryParams = Record<string, string | string[] | undefined>;

export const directoryColumnFields = {
  areas: {
    name: { key: "name", label: "责任田名称", kind: "text" },
    description: { key: "description", label: "责任田说明", kind: "text" },
    type: {
      key: "type", label: "责任田类型", kind: "choices",
      options: [{ value: "standard", label: "普通责任田" }, { value: "integration", label: "集成测试责任田" }],
    },
    leaders: { key: "leaders", label: "主管", kind: "choices" },
    projects: { key: "projects", label: "已设负责人的项目数", kind: "number" },
    packages: { key: "packages", label: "软件包数量", kind: "number" },
  },
  packages: {
    code: { key: "code", label: "软件包编码", kind: "text" },
    name: { key: "name", label: "软件包名称", kind: "text" },
    area: { key: "area", label: "责任田", kind: "choices" },
    owner: { key: "owner", label: "责任人", kind: "choices" },
    enabled: {
      key: "enabled", label: "启停状态", kind: "choices",
      options: [{ value: "active", label: "启用" }, { value: "inactive", label: "停用" }],
    },
    progress: { key: "progress", label: "当前流程状态", kind: "choices" },
    versions: { key: "versions", label: "版本记录", kind: "number" },
    nodes: { key: "nodes", label: "使用节点", kind: "number" },
  },
  users: {
    name: { key: "name", label: "姓名", kind: "text" },
    title: { key: "title", label: "职位", kind: "text" },
    department: { key: "department", label: "部门", kind: "text" },
    employeeId: { key: "employeeId", label: "工号", kind: "text" },
    role: { key: "role", label: "系统角色", kind: "choices" },
    area: { key: "area", label: "责任田", kind: "choices" },
    status: {
      key: "status", label: "账号状态", kind: "choices",
      options: [{ value: "active", label: "启用" }, { value: "inactive", label: "停用" }],
    },
    packages: { key: "packages", label: "软件包数量", kind: "number" },
  },
} satisfies Record<string, Record<string, ColumnFilterField>>;

export type Directory = keyof typeof directoryColumnFields;

const sharedKeys = ["q", "sort", "order", "page", "pageSize"];
const directoryKeys: Record<Directory, string[]> = {
  areas: [...sharedKeys, "type", "scope", ...Object.values(directoryColumnFields.areas).flatMap(columnFilterKeys)],
  packages: [...sharedKeys, "area", "state", ...Object.values(directoryColumnFields.packages).flatMap(columnFilterKeys), "historyPage"],
  users: [...sharedKeys, "area", "status", ...Object.values(directoryColumnFields.users).flatMap(columnFilterKeys)],
};

export const directoryCollator = new Intl.Collator("zh-Hans-CN", { numeric: true, sensitivity: "base" });

export function directoryValue(value: string | string[] | undefined) {
  return typeof value === "string" ? value.trim().slice(0, 120) : "";
}

export function directoryFilters(directory: Directory, params: DirectoryParams) {
  return Object.fromEntries(
    directoryKeys[directory].flatMap((key) => {
      const raw = params[key];
      const value = key.startsWith("f_")
        ? typeof raw === "string" && raw.length <= 4096 ? raw.trim() : ""
        : directoryValue(raw);
      return value ? [[key, value]] : [];
    }),
  );
}

export function directoryHref(path: string, params: Record<string, string | undefined> = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }
  const search = query.toString();
  return search ? `${path}?${search}` : path;
}

export function areaDirectoryListParams(params: DirectoryParams) {
  return directoryFilters("areas", { ...params, q: params.listQ, page: params.listPage, pageSize: params.listPageSize });
}

export function areaDirectoryDetailParams(params: DirectoryParams) {
  const { q, page, pageSize, ...filters } = directoryFilters("areas", params);
  return { ...filters, listQ: q, listPage: page, listPageSize: pageSize };
}

export function projectDirectoryListParams(params: DirectoryParams, fromDetail = false) {
  const q = directoryValue(fromDetail ? params.listQ : params.q);
  const status = fromDetail ? params.listStatus : params.status;
  const page = readListPage(directoryValue(fromDetail ? params.listPage : params.page));
  return {
    q: q || undefined,
    status: status === "ACTIVE" || status === "PAUSED" || status === "ARCHIVED" ? status : undefined,
    page: page > 1 ? String(page) : undefined,
  };
}

export function projectDirectoryDetailParams(params: DirectoryParams) {
  const { q, status, page } = projectDirectoryListParams(params);
  return { listQ: q, listStatus: status, listPage: page };
}

export function directoryActionHref(directory: Directory, formData: FormData, id?: number) {
  const filters = directoryFilters(directory, Object.fromEntries(
    directoryKeys[directory].map((key) => {
      const value = formData.get(key);
      return [key, typeof value === "string" ? value : undefined];
    }),
  ));
  return directoryHref(id === undefined ? `/settings/${directory}` : `/settings/${directory}/${id}`, filters);
}

export function directoryPage<T>(items: T[], value: string | string[] | undefined, pageSize: number) {
  const { current: page, pages, offset, end } = getPageWindow(items.length, pageSize, readListPage(directoryValue(value)));
  return { items: items.slice(offset, end), page, pages, total: items.length };
}

export function directoryOrder<T extends { id: number }>(
  items: T[],
  columns: Record<string, (item: T) => string | number>,
  params: DirectoryParams,
  defaultSort: string,
) {
  const requested = directoryValue(params.sort);
  const sort = Object.hasOwn(columns, requested) ? requested : defaultSort;
  const order = params.order === "desc" ? "desc" : "asc";
  const valueOf = columns[sort];
  const sorted = items.toSorted((a, b) => {
    const left = valueOf(a);
    const right = valueOf(b);
    const comparison = typeof left === "number" && typeof right === "number"
      ? left - right
      : directoryCollator.compare(String(left), String(right));
    return (order === "asc" ? comparison : -comparison) || a.id - b.id;
  });
  return { sorted, sort, order } as const;
}
