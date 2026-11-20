type NavigationProject = { id: number; name: string };

export function findWorkspaceProject(
  pathname: string,
  projectParams: string[],
  workflowPaths: string[],
  projects: NavigationProject[],
) {
  const detailId = /^\/projects\/(\d+)$/.exec(pathname)?.[1];
  const isWorkflow = workflowPaths.some((path) => pathname === path || pathname.startsWith(path + "/"));
  const scopedId = isWorkflow && projectParams.length === 1 ? projectParams[0] : undefined;
  const id = Number(detailId ?? scopedId);
  return projects.find((project) => project.id === id);
}
