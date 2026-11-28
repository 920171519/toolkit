import { parsePositiveSafeInteger } from "./positive-integer";
import "server-only";

import { notFound } from "next/navigation";
import { canAccessProjectPage, getProjectWorkflowProjectIds, hasReadablePackageInProject } from "./access";
import { getProjectOption, getProjectOptions, type ProjectOption } from "./project-queries";
import type { SessionUser } from "./types";

export type WorkspaceProjectEntry = ProjectOption | Pick<ProjectOption, "id" | "name">;

export function getWorkspaceProjectNavigation(user: SessionUser): WorkspaceProjectEntry[] {
  const ids = getProjectWorkflowProjectIds(user, true);
  const projects = getProjectOptions(true);
  if (ids === null) return projects;
  const allowed = new Set(ids);
  return projects.map((project) => allowed.has(project.id) ? project : { id: project.id, name: project.name });
}

export function getReadablePackageProject(user: SessionUser, value: string | string[] | undefined) {
  const projectId = parsePositiveSafeInteger(value);
  if (projectId === undefined) return undefined;
  const project = getProjectOption(projectId);
  if (!project || canAccessProjectPage(user, projectId)) return project;
  return hasReadablePackageInProject(user, projectId) ? project : undefined;
}

export function requireReadablePackageProject(user: SessionUser, value: string | string[] | undefined) {
  if (value === undefined || value === "") return undefined;
  const project = getReadablePackageProject(user, value);
  if (!project) notFound();
  return project;
}

export function requireWorkflowProject(
  user: SessionUser,
  value: string | string[] | undefined,
  expectedProjectId?: number,
  allowObjectScope = false,
) {
  if (value === undefined || value === "") return undefined;
  const id = parsePositiveSafeInteger(value);
  if (id === undefined || (expectedProjectId !== undefined && id !== expectedProjectId)) notFound();
  const project = canAccessProjectPage(user, id) ? getProjectOption(id) : undefined;
  // Some detail pages independently authorize a specific record, without granting project navigation.
  if (!project && allowObjectScope && expectedProjectId === id) return undefined;
  if (!project) notFound();
  return project;
}
