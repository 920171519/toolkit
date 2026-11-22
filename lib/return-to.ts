const workspaceRoots = new Set(["dashboard", "overview", "projects", "packages", "submissions", "integration", "trial", "formal", "versions", "settings"]);

export function safeWorkspacePath(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("/") || value.length > 2048) return undefined;
  try {
    const base = "http://toolkit.local";
    const target = new URL(value, base);
    if (target.origin !== base || !workspaceRoots.has(target.pathname.split("/")[1])) return undefined;
    return target.pathname + target.search + target.hash;
  } catch {
    return undefined;
  }
}

export function safeOverviewReturnPath(value: unknown): string | undefined {
  const path = safeWorkspacePath(value);
  if (!path) return undefined;
  const target = new URL(path, "http://toolkit.local");
  if (target.pathname !== "/overview") return undefined;
  const filtered = new URLSearchParams();
  for (const key of ["q", "stage", "page", "pageSize", "f_name", "f_name_mode", "f_code", "f_code_mode", "f_stage", "f_pm", "f_manager"]) {
    const field = target.searchParams.get(key);
    if (field && field.length <= (key.startsWith("f_") ? 2048 : 100)) filtered.set(key, field);
  }
  return filtered.size ? `/overview?${filtered.toString()}` : "/overview";
}
