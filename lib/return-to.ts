import { projectOverviewReturnKeys } from "./project-overview-filters";

const workspaceOrigin = "http://toolkit.local";
const workspacePathPrefixes = [
  "/dashboard", "/overview", "/projects", "/packages", "/submissions",
  "/integration", "/trial", "/formal", "/versions", "/settings",
];
const workspaceExactPaths = ["/account/password"];

export function safeWorkspacePath(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("/") || value.length > 2048) return undefined;
  try {
    const target = new URL(value, workspaceOrigin);
    if (target.origin !== workspaceOrigin) return undefined;
    if (!workspaceExactPaths.includes(target.pathname)
      && !workspacePathPrefixes.some((prefix) => target.pathname === prefix || target.pathname.startsWith(`${prefix}/`))) return undefined;
    return target.pathname + target.search + target.hash;
  } catch {
    return undefined;
  }
}

export function safeOverviewReturnPath(value: unknown): string | undefined {
  const path = safeWorkspacePath(value);
  if (!path) return undefined;
  const target = new URL(path, workspaceOrigin);
  if (target.pathname !== "/overview") return undefined;
  const filtered = new URLSearchParams();
  for (const key of projectOverviewReturnKeys) {
    const field = target.searchParams.get(key);
    if (field && field.length <= (key.startsWith("f_") ? 2048 : 100)) filtered.set(key, field);
  }
  return filtered.size ? `/overview?${filtered.toString()}` : "/overview";
}
