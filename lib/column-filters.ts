export type ColumnFilterOption = { value: string; label: string };

export type ColumnFilterField = {
  key: string;
  label: string;
  kind: "text" | "number" | "date" | "choices";
  options?: ColumnFilterOption[];
};

type FilterParams = Record<string, string | string[] | undefined>;
type Filters = Record<string, string | undefined>;

const choiceId = /^[A-Za-z0-9_-]+$/;
const collator = new Intl.Collator("zh-Hans-CN", { numeric: true, sensitivity: "base" });

export function columnFilterKeys({ key, kind }: ColumnFilterField) {
  const name = `f_${key}`;
  if (kind === "number" || kind === "date") return [`${name}_min`, `${name}_max`];
  if (kind === "text") return [name, `${name}_mode`];
  return [name];
}

function integer(value: string | string[] | undefined) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : undefined;
}

export function parseFilterDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : undefined;
}

export function readColumnFilters(params: FilterParams, fields: ColumnFilterField[]) {
  const filters: Record<string, string> = {};
  for (const field of fields) {
    const [name, second] = columnFilterKeys(field);
    const value = params[name];
    if (field.kind === "text") {
      const search = typeof value === "string" ? value.trim().slice(0, 120) : "";
      if (search) {
        filters[name] = search;
        if (params[second] === "exact") filters[second] = "exact";
      }
    } else if (field.kind === "number" || field.kind === "date") {
      const parse = field.kind === "number" ? integer : parseFilterDate;
      const min = parse(value);
      const max = parse(params[second]);
      if (min !== undefined && max !== undefined && min > max) continue;
      if (min !== undefined) filters[name] = String(min);
      if (max !== undefined) filters[second] = String(max);
    } else {
      const input = typeof value === "string" ? [value] : value ?? [];
      const values = new Set(input.flatMap((part) => part.split(",")).map((part) => part.trim()).filter((part) => choiceId.test(part)));
      const selected = [...values].join(",");
      if (selected && selected.length <= 4096) filters[name] = selected;
    }
  }
  return filters;
}

function normalize(value: string) {
  return value.normalize("NFKC").trim().toLowerCase();
}

export function matchesTextFilter(filters: Filters, key: string, value?: string | null) {
  const condition = filters[`f_${key}`];
  if (!condition) return true;
  const candidate = normalize(value ?? "");
  const search = normalize(condition);
  return filters[`f_${key}_mode`] === "exact" ? candidate === search : candidate.includes(search);
}

export function matchesNumberFilter(filters: Filters, key: string, value: number) {
  const min = filters[`f_${key}_min`];
  const max = filters[`f_${key}_max`];
  return (min === undefined || value >= Number(min)) && (max === undefined || value <= Number(max));
}

export function matchesDateFilter(filters: Filters, key: string, value: string) {
  const min = filters[`f_${key}_min`];
  const max = filters[`f_${key}_max`];
  if (min === undefined && max === undefined) return true;
  return value !== "—" && (min === undefined || value >= min) && (max === undefined || value <= max);
}

export function matchesChoiceFilter(filters: Filters, key: string, values: string[]) {
  const condition = filters[`f_${key}`];
  if (!condition) return true;
  const selected = condition.split(",");
  return values.some((value) => selected.includes(value));
}

export function filterOptions(entries: ColumnFilterOption[]) {
  return [...new Map(entries.map((entry) => [entry.value, entry])).values()]
    .sort((a, b) => collator.compare(a.label, b.label) || collator.compare(a.value, b.value));
}
