import "server-only";

import { all, one } from "./db";
import { getProjectStage, type ProjectStage } from "./project-stage";

export type ProjectOption = {
  id: number;
  name: string;
  code: string;
  status: "ACTIVE" | "PAUSED" | "ARCHIVED";
};

export type ProjectContact = {
  id: number;
  name: string;
  employeeId: string;
  title: string;
};

type ProjectAssignments = {
  pms: ProjectContact[];
  softwareManagers: ProjectContact[];
};

type ProjectRecord = ProjectOption & {
  description: string;
  stage: ProjectStage;
};

type ProjectSelection = { projectId?: number; projectIds?: readonly number[] | null; includeArchived: boolean };

const projectOptionColumns = "p.id, p.name, p.code, p.status";
const projectRecordColumns = `${projectOptionColumns}, p.description, p.stage`;

function readProjects<T extends ProjectOption>(columns: string, { projectId, projectIds, includeArchived }: ProjectSelection): T[] {
  if (projectIds?.length === 0) return [];

  const predicates: string[] = [];
  const params: Array<number | string> = [];
  if (!includeArchived) predicates.push("p.status != 'ARCHIVED'");
  if (projectId !== undefined) {
    predicates.push("p.id = ?");
    params.push(projectId);
  }
  if (projectIds) {
    predicates.push("p.id IN (SELECT value FROM json_each(?))");
    params.push(JSON.stringify(projectIds));
  }
  const where = predicates.length ? `WHERE ${predicates.join(" AND ")}` : "";
  return all<T>(
    `SELECT ${columns} FROM projects p ${where} ORDER BY p.sort_order, p.id`,
    ...params,
  );
}

function readProjectsWithContacts<T extends ProjectOption>(columns: string, selection: ProjectSelection): Array<T & ProjectAssignments> {
  const projects: Array<T & ProjectAssignments> = readProjects<T>(columns, selection).map((project) => ({
    ...project,
    pms: [],
    softwareManagers: [],
  }));
  if (projects.length === 0) return projects;

  const assignments = all<Omit<ProjectContact, "id"> & { projectId: number; contactId: number; role: "PM" | "MANAGER" }>(
    `WITH selected_projects AS (SELECT value AS id FROM json_each(?))
     SELECT pp.project_id AS projectId, 'PM' AS role, u.id AS contactId, u.name,
            u.employee_id AS employeeId, u.title, pp.created_at AS assignedAt
     FROM project_pms pp JOIN selected_projects p ON p.id = pp.project_id
     JOIN users u ON u.id = pp.user_id
     UNION ALL
     SELECT psm.project_id, 'MANAGER', u.id, u.name, u.employee_id, u.title, psm.created_at
     FROM project_software_managers psm JOIN selected_projects p ON p.id = psm.project_id
     JOIN users u ON u.id = psm.user_id
     ORDER BY assignedAt, contactId`,
    JSON.stringify(projects.map(({ id }) => id)),
  );
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  for (const { projectId, role, contactId, name, employeeId, title } of assignments) {
    const project = projectsById.get(projectId);
    const contacts = role === "PM" ? project?.pms : project?.softwareManagers;
    contacts?.push({ id: contactId, name, employeeId, title });
  }
  return projects;
}

export type PublicProject = ProjectOption & ProjectAssignments;
export type ProjectCatalogEntry = ProjectRecord & ProjectAssignments;

export function getProjectOptions(includeArchived = false): ProjectOption[] {
  return readProjects(projectOptionColumns, { includeArchived });
}

export function getPublicProjects(): PublicProject[] {
  return readProjectsWithContacts(projectOptionColumns, { includeArchived: false });
}

export function getProjectCatalogEntries(projectId?: number): ProjectCatalogEntry[] {
  return readProjectsWithContacts<ProjectRecord>(projectRecordColumns, { projectId, includeArchived: true })
    .map((project) => ({ ...project, stage: getProjectStage(project.status, project.stage) }));
}

export function getProjectSettingsDirectory(projectIds: readonly number[] | null) {
  return readProjectsWithContacts<Omit<ProjectRecord, "description"> & { nodeCount: number }>(
    `${projectOptionColumns}, p.stage,
     (SELECT COUNT(*) FROM project_nodes n WHERE n.project_id = p.id) AS nodeCount`,
    { projectIds, includeArchived: true },
  ).map(({ pms, softwareManagers, ...project }) => ({
    ...project,
    pmName: pms.map((person) => person.name).join(" / ") || null,
    softwareManagerName: softwareManagers.map((person) => person.name).join(" / ") || null,
  }));
}

type ProjectNode = {
  id: number;
  name: string;
  description: string;
  bindingOwnerId: number | null;
  bindingOwnerName: string | null;
  bindingApproverId: number | null;
  bindingApproverName: string | null;
  requiredBindingCount: number;
};

type ProjectNodeOption = Pick<ProjectNode, "id" | "name" | "description">;
export type ProjectOptionWithNodes = ProjectOption & { nodes: ProjectNodeOption[] };

const projectNodeOptionColumns = "n.id, n.name, n.description";

export function getProjectOptionsWithNodes(): ProjectOptionWithNodes[] {
  const projects: ProjectOptionWithNodes[] = getProjectOptions(true).map((project) => ({ ...project, nodes: [] }));
  if (projects.length === 0) return projects;

  const byId = new Map(projects.map((project) => [project.id, project]));
  const nodes = all<ProjectNodeOption & { projectId: number }>(
    `SELECT n.project_id AS projectId, ${projectNodeOptionColumns}
     FROM project_nodes n
     WHERE n.project_id IN (SELECT value FROM json_each(?))
     ORDER BY n.project_id, n.sort_order, n.id`,
    JSON.stringify(projects.map(({ id }) => id)),
  );
  for (const { projectId, ...node } of nodes) byId.get(projectId)?.nodes.push(node);
  return projects;
}

type NodeApprover = {
  id: number;
  userId: number;
  userName: string;
  userEmployeeId: string;
};

export type ProjectConfig = ProjectRecord & ProjectAssignments & {
  nodes: Array<ProjectNode & { approverCount: number }>;
};

const projectNodeConfigColumns = `${projectNodeOptionColumns}, n.binding_owner_id AS bindingOwnerId,
  bo.name AS bindingOwnerName, n.binding_approver_id AS bindingApproverId,
  ba.name AS bindingApproverName, n.required_binding_count AS requiredBindingCount`;
const projectNodeConfigFrom = `FROM project_nodes n
  LEFT JOIN users bo ON bo.id = n.binding_owner_id
  LEFT JOIN users ba ON ba.id = n.binding_approver_id`;

const nodeApproversFrom = `FROM project_node_approvers pna JOIN users u ON u.id = pna.user_id`;

export function getProjectConfig(projectId: number): ProjectConfig | null {
  const [project] = readProjectsWithContacts<ProjectRecord>(projectRecordColumns, { projectId, includeArchived: true });
  if (!project) return null;
  const nodes = all<ProjectConfig["nodes"][number]>(
    `SELECT ${projectNodeConfigColumns},
            (SELECT COUNT(*) ${nodeApproversFrom} WHERE pna.node_id = n.id) AS approverCount
     ${projectNodeConfigFrom}
     WHERE n.project_id = ? ORDER BY n.sort_order, n.id`,
    projectId,
  );
  return { ...project, nodes };
}

export function getProjectNodeConfig(projectId: number, nodeId: number) {
  const row = one<ProjectNode & { projectName: string; projectCode: string }>(
    `SELECT ${projectNodeConfigColumns}, p.name AS projectName, p.code AS projectCode
     ${projectNodeConfigFrom}
     JOIN projects p ON p.id = n.project_id
     WHERE p.id = ? AND n.id = ?`,
    projectId,
    nodeId,
  );
  if (!row) return null;
  const { projectName, projectCode, ...node } = row;
  const approvers = all<NodeApprover>(
    `SELECT pna.id, pna.user_id AS userId, u.name AS userName, u.employee_id AS userEmployeeId
     ${nodeApproversFrom}
     WHERE pna.node_id = ? ORDER BY pna.id`,
    nodeId,
  );
  return {
    project: { name: projectName, code: projectCode },
    node: { ...node, approvers },
  };
}
