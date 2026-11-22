import "server-only";

import { all, one } from "@/lib/db";
import type { BatchConclusion, BatchStatus } from "@/lib/constants";
import { getProjectStage, type ProjectStage } from "@/lib/project-stage";
import type { ProjectConfig, ProjectContact } from "@/lib/queries";

type ProjectPerson = Pick<ProjectContact, "id" | "name" | "employeeId">;

export type ProjectCatalogEntry = Pick<ProjectConfig, "id" | "name" | "code" | "description" | "status"> & {
  stage: ProjectStage;
  pms: ProjectPerson[];
  softwareManagers: ProjectPerson[];
};

export function getProjectCatalogEntries(projectIds: number[] | null = null): ProjectCatalogEntry[] {
  if (projectIds?.length === 0) return [];

  const clause = projectIds ? `WHERE p.id IN (${projectIds.map(() => "?").join(",")})` : "";
  const bindings = projectIds ?? [];
  const projects = all<Omit<ProjectCatalogEntry, "pms" | "softwareManagers">>(
    `SELECT p.id, p.name, p.code, p.description, p.status, p.stage
     FROM projects p ${clause} ORDER BY p.sort_order, p.id`,
    ...bindings,
  );
  const contacts = all<ProjectPerson & { projectId: number; role: "PM" | "MANAGER" }>(
    `WITH visible_projects AS (SELECT p.id FROM projects p ${clause})
     SELECT pp.project_id AS projectId, 'PM' AS role, u.name, u.employee_id AS employeeId,
            pp.created_at AS assignedAt, u.id AS id
     FROM project_pms pp JOIN visible_projects vp ON vp.id = pp.project_id
     JOIN users u ON u.id = pp.user_id
     UNION ALL
     SELECT psm.project_id, 'MANAGER', u.name, u.employee_id, psm.created_at, u.id
     FROM project_software_managers psm JOIN visible_projects vp ON vp.id = psm.project_id
     JOIN users u ON u.id = psm.user_id
     ORDER BY assignedAt, id`,
    ...bindings,
  );
  const entries: ProjectCatalogEntry[] = projects.map((project) => ({
    ...project,
    stage: getProjectStage(project.status, project.stage),
    pms: [],
    softwareManagers: [],
  }));
  const byId = new Map(entries.map((project) => [project.id, project]));
  for (const { projectId, role, id, name, employeeId } of contacts) {
    const project = byId.get(projectId);
    const assignment = role === "PM" ? project?.pms : project?.softwareManagers;
    assignment?.push({ id, name, employeeId });
  }
  return entries;
}

export function getProjectBatchCounts(projectId: number, includeDrafts: boolean) {
  return one<{ draft: number; inTest: number }>(
    `SELECT COUNT(*) FILTER (WHERE status = 'DRAFT') AS draft,
            COUNT(*) FILTER (WHERE status = 'IN_TEST') AS inTest
     FROM integration_batches WHERE project_id = ? AND (status = 'IN_TEST' OR (? = 1 AND status = 'DRAFT'))`,
    projectId,
    Number(includeDrafts),
  ) ?? { draft: 0, inTest: 0 };
}

export function getRecentProjectBatches(projectId: number, limit: number, includeDrafts: boolean) {
  return all<{ id: number; code: string; title: string; status: BatchStatus; conclusion: BatchConclusion | null; activityAt: string }>(
    `SELECT id, code, title, status, conclusion, COALESCE(completed_at, terminated_at, sent_at, created_at) AS activityAt
     FROM integration_batches
     WHERE project_id = ? AND (? = 1 OR status != 'DRAFT')
     ORDER BY activityAt DESC, id DESC LIMIT ?`,
    projectId,
    Number(includeDrafts),
    limit,
  );
}
