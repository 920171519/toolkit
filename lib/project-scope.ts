import "server-only";

import { notFound } from "next/navigation";
import { getManagedProjectIdsForUser } from "./access";
import type { SessionUser } from "./types";
import { getProjectOptions, getWorkflowProjectScope } from "./workflow-queries";

export function getWorkflowProjectOptions(user: SessionUser, includeArchived = false) {
  const ids = includeArchived && user.role === "SOFTWARE_MANAGER"
    ? getManagedProjectIdsForUser(user.id)
    : getWorkflowProjectScope(user);
  const projects = getProjectOptions(includeArchived);
  if (ids === null) return projects;
  const allowed = new Set(ids);
  return projects.filter((project) => allowed.has(project.id));
}

export function requireWorkflowProject(
  user: SessionUser,
  value: string | string[] | undefined,
  expectedProjectId?: number,
) {
  if (value === undefined || value === "") return undefined;
  if (Array.isArray(value)) notFound();
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1 || (expectedProjectId !== undefined && id !== expectedProjectId)) notFound();
  const project = getWorkflowProjectOptions(user, true).find((option) => option.id === id);
  if (!project) notFound();
  return project;
}
