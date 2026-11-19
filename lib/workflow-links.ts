export function workflowHref(
  path: string,
  projectId?: number | null,
  params: Record<string, string | number | undefined> = {},
): string {
  const query = new URLSearchParams();
  if (projectId && Number.isSafeInteger(projectId) && projectId > 0) {
    query.set("project", String(projectId));
  }
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined) query.set(name, String(value));
  }
  return query.size ? `${path}?${query}` : path;
}
