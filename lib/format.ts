const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return dateTimeFormatter.format(date).replaceAll("/", "-");
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return dateFormatter.format(date).replaceAll("/", "-");
}

export function formatRelative(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value).getTime();
  if (Number.isNaN(date)) return "—";
  const diff = date - Date.now();
  const abs = Math.abs(diff);
  const formatter = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });
  if (abs < 60 * 60 * 1000) return formatter.format(Math.round(diff / 60000), "minute");
  if (abs < 24 * 60 * 60 * 1000) return formatter.format(Math.round(diff / 3600000), "hour");
  if (abs < 30 * 24 * 60 * 60 * 1000) return formatter.format(Math.round(diff / 86400000), "day");
  return formatDate(value);
}

export function initials(name: string): string {
  const clean = name.trim();
  if (!clean) return "?";
  if (/^[\u4e00-\u9fa5]+$/.test(clean)) return clean.slice(-2);
  return clean
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
