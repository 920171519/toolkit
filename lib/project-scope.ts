import "server-only";

import { notFound } from "next/navigation";
import { canAccessProjectPage, getProjectWorkflowProjectIds, getReadablePackageIds } from "./access";
import { one } from "./db";
import { getProjectOptions } from "./project-queries";
import type { SessionUser } from "./types";

export function getWorkflowProjectOptions(user: SessionUser, includeArchived = false) {
  const ids = getProjectWorkflowProjectIds(user, includeArchived);
  const projects = getProjectOptions(includeArchived);
  if (ids === null) return projects;
  const allowed = new Set(ids);
  return projects.filter((project) => allowed.has(project.id));
}

export function getReadablePackageProject(user: SessionUser, projectId: number) {
  if (!Number.isSafeInteger(projectId) || projectId < 1) return undefined;
  const project = getProjectOptions(true).find((option) => option.id === projectId);
  if (!project || canAccessProjectPage(user, projectId)) return project;
  const packageIds = getReadablePackageIds(user);
  return one(`SELECT 1 FROM package_usages WHERE project_id = ? AND package_id IN (SELECT value FROM json_each(?)) LIMIT 1`,
    projectId, JSON.stringify(packageIds)) ? project : undefined;
}

export function requireReadablePackageProject(user: SessionUser, value: string | string[] | undefined) {
  if (value === undefined || value === "") return undefined;
  const project = typeof value === "string" ? getReadablePackageProject(user, Number(value)) : undefined;
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
  if (Array.isArray(value)) notFound();
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1 || (expectedProjectId !== undefined && id !== expectedProjectId)) notFound();
  const project = getWorkflowProjectOptions(user, true).find((option) => option.id === id);
  // Some detail pages independently authorize a specific record, without granting project navigation.
  if (!project && allowObjectScope && expectedProjectId === id) return undefined;
  if (!project) notFound();
  return project;
}
