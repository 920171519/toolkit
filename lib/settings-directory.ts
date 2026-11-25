export type DirectoryParams = Record<string, string | string[] | undefined>;
export type Directory = "areas" | "packages" | "users";

const sharedKeys = ["q", "sort", "order", "page", "pageSize"];
const filterKeys = {
  areas: ["type", "scope", "f_name", "f_name_mode", "f_description", "f_description_mode", "f_type", "f_leaders", "f_projects_min", "f_projects_max", "f_packages_min", "f_packages_max"],
  packages: ["area", "state", "f_code", "f_code_mode", "f_name", "f_name_mode", "f_area", "f_owner", "f_enabled", "f_progress", "f_versions_min", "f_versions_max", "f_nodes_min", "f_nodes_max", "historyPage"],
  users: ["area", "status", "f_name", "f_name_mode", "f_title", "f_title_mode", "f_department", "f_department_mode", "f_employeeId", "f_employeeId_mode", "f_role", "f_area", "f_status", "f_packages_min", "f_packages_max"],
};

export const directoryCollator = new Intl.Collator("zh-Hans-CN", { numeric: true, sensitivity: "base" });

export function directoryValue(value: string | string[] | undefined) {
  return typeof value === "string" ? value.trim().slice(0, 120) : "";
}

export function directoryFilters(directory: Directory, params: DirectoryParams) {
  return Object.fromEntries(
    [...sharedKeys, ...filterKeys[directory]].flatMap((key) => {
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
  const page = Number(directoryValue(fromDetail ? params.listPage : params.page));
  return {
    q: q || undefined,
    status: status === "ACTIVE" || status === "PAUSED" || status === "ARCHIVED" ? status : undefined,
    page: Number.isSafeInteger(page) && page > 1 ? String(page) : undefined,
  };
}

export function projectDirectoryDetailParams(params: DirectoryParams) {
  const { q, status, page } = projectDirectoryListParams(params);
  return { listQ: q, listStatus: status, listPage: page };
}

export function directoryActionHref(directory: Directory, formData: FormData, id?: number) {
  const filters = directoryFilters(directory, Object.fromEntries(
    [...sharedKeys, ...filterKeys[directory]].map((key) => {
      const value = formData.get(key);
      return [key, typeof value === "string" ? value : undefined];
    }),
  ));
  return directoryHref(id === undefined ? `/settings/${directory}` : `/settings/${directory}/${id}`, filters);
}

export function matchesDirectorySearch(search: string, ...values: Array<string | null | undefined>) {
  const normal = (value: string) => value.normalize("NFKC").toLowerCase();
  const words = normal(search).split(/\s+/).filter(Boolean);
  const text = normal(values.join(" "));
  return words.every((word) => text.includes(word));
}

export function directoryPage<T>(items: T[], value: string | string[] | undefined, pageSize: number) {
  const requested = Number(directoryValue(value));
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Number.isSafeInteger(requested) ? Math.min(pages, Math.max(1, requested)) : 1;
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), page, pages, total: items.length };
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
