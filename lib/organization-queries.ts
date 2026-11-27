import "server-only";

import type { Role } from "./constants";
import { all, one } from "./db";

export type AdminUser = {
  id: number;
  name: string;
  employeeId: string;
  role: Role;
  title: string;
  department: string;
  isActive: boolean;
  createdAt: string;
  ownedPackages: number;
  activeOwnedPackages: number;
  areas: Array<{ id: number; name: string }>;
};

export function getAdminUsers(userId?: number): AdminUser[] {
  const memberships = getAreaMemberships(userId);
  const areasByUser = Map.groupBy(memberships, (membership) => membership.userId);
  return all<Omit<AdminUser, "isActive" | "areas"> & { isActive: number }>(
    `SELECT u.id, u.name, u.employee_id AS employeeId, u.role, u.title, u.department,
            u.is_active AS isActive, u.created_at AS createdAt,
            (SELECT COUNT(*) FROM packages p WHERE p.owner_id = u.id) AS ownedPackages,
            (SELECT COUNT(*) FROM packages p WHERE p.owner_id = u.id AND p.is_active = 1) AS activeOwnedPackages
     FROM users u
     ${userId === undefined ? "" : "WHERE u.id = ?"}
     ORDER BY u.is_active DESC, u.created_at, u.id`,
    ...(userId === undefined ? [] : [userId]),
  ).map((row) => ({
    ...row,
    isActive: Boolean(row.isActive),
    ownedPackages: Number(row.ownedPackages),
    activeOwnedPackages: Number(row.activeOwnedPackages),
    areas: (areasByUser.get(row.id) ?? []).map(({ areaId, name }) => ({ id: areaId, name })),
  }));
}

export type PersonOption = {
  id: number;
  name: string;
  employeeId: string;
  title: string;
  role: Role;
};

export function getPeople(includeInactive = false): PersonOption[] {
  return all<PersonOption>(
    `SELECT id, name, employee_id AS employeeId, title, role FROM users
     ${includeInactive ? "" : "WHERE is_active = 1"} ORDER BY name`,
  );
}

export type AreaProjectLead = {
  id: number;
  projectId: number;
  projectName: string;
  projectCode: string;
  projectStatus: "ACTIVE" | "PAUSED" | "ARCHIVED";
  userId: number;
  userName: string;
  userEmployeeId: string;
  userTitle: string;
};

type AreaLeader = {
  id: number;
  userId: number;
  userName: string;
  userEmployeeId: string;
  userTitle: string;
};

export type AreaProjectMember = {
  id: number;
  areaId: number;
  projectId: number;
  projectName: string;
  projectCode: string;
  userId: number;
  userName: string;
  userEmployeeId: string;
  userTitle: string;
};

type AreaConfig = {
  id: number;
  name: string;
  description: string;
  isIntegration: boolean;
  packageCount: number;
  leaders: AreaLeader[];
  projectLeads: AreaProjectLead[];
  projectMembers: AreaProjectMember[];
};

export function getAreaMemberships(userId?: number) {
  return all<{ userId: number; areaId: number; name: string }>(
    `WITH memberships AS (
      SELECT user_id, area_id FROM area_leaders
      UNION
      SELECT user_id, area_id FROM area_project_leads
      UNION
      SELECT user_id, area_id FROM area_project_members
    )
    SELECT m.user_id AS userId, m.area_id AS areaId, a.name
    FROM memberships m JOIN areas a ON a.id = m.area_id
    ${userId === undefined ? "" : "WHERE m.user_id = ?"}
    ORDER BY a.name, a.id`,
    ...(userId === undefined ? [] : [userId]),
  );
}

export function getAccountAreaLabel(userId: number): string {
  return getAreaMemberships(userId).map(({ name }) => name).join("、") || "未分配责任田";
}

export function getResponsibilityAreaOptions({ orderBy = "name" }: { orderBy?: "name" | "id" } = {}) {
  const order = orderBy === "id" ? "id" : "name, id";
  return all<{ id: number; name: string }>(`SELECT id, name FROM areas ORDER BY ${order}`);
}

export function getAreaDirectory() {
  const supervisors = all<AreaLeader & { areaId: number }>(
    `SELECT al.id, al.area_id AS areaId, u.id AS userId, u.name AS userName,
            u.employee_id AS userEmployeeId, u.title AS userTitle
     FROM area_leaders al JOIN users u ON u.id = al.user_id
     ORDER BY al.id`,
  );
  const supervisorsByArea = Map.groupBy(supervisors, (leader) => leader.areaId);

  return all<{
    id: number;
    name: string;
    description: string;
    isIntegration: number;
    packageCount: number;
    projectCount: number;
  }>(
    `SELECT a.id, a.name, a.description, a.is_integration AS isIntegration,
            (SELECT COUNT(*) FROM packages p WHERE p.area_id = a.id) AS packageCount,
            (SELECT COUNT(*) FROM area_project_leads apl WHERE apl.area_id = a.id) AS projectCount
     FROM areas a ORDER BY a.id`,
  ).map((area) => ({
    ...area,
    isIntegration: Boolean(area.isIntegration),
    leaders: supervisorsByArea.get(area.id) ?? [],
  }));
}

export function getAreaConfig(areaId: number): AreaConfig | null {
  const area = one<{
    id: number;
    name: string;
    description: string;
    isIntegration: number;
    packageCount: number;
  }>(
    `SELECT a.id, a.name, a.description, a.is_integration AS isIntegration,
            (SELECT COUNT(*) FROM packages p WHERE p.area_id = a.id) AS packageCount
     FROM areas a WHERE a.id = ?`,
    areaId,
  );
  if (!area) return null;

  const leaders = all<AreaLeader>(
    `SELECT al.id, u.id AS userId, u.name AS userName, u.employee_id AS userEmployeeId, u.title AS userTitle
     FROM area_leaders al JOIN users u ON u.id = al.user_id
     WHERE al.area_id = ? ORDER BY al.id`,
    area.id,
  );
  const projectMembers = all<AreaProjectMember>(
    `SELECT apm.id, apm.area_id AS areaId, apm.project_id AS projectId, pr.name AS projectName,
            pr.code AS projectCode, u.id AS userId, u.name AS userName,
            u.employee_id AS userEmployeeId, u.title AS userTitle
     FROM area_project_members apm
     JOIN projects pr ON pr.id = apm.project_id
     JOIN users u ON u.id = apm.user_id
     WHERE apm.area_id = ?
     ORDER BY pr.sort_order, u.name`,
    area.id,
  );
  const projectLeads = all<AreaProjectLead>(
    `SELECT apl.id, apl.project_id AS projectId, pr.name AS projectName,
            pr.code AS projectCode, pr.status AS projectStatus,
            u.id AS userId, u.name AS userName, u.employee_id AS userEmployeeId, u.title AS userTitle
     FROM area_project_leads apl
     JOIN projects pr ON pr.id = apl.project_id
     JOIN users u ON u.id = apl.user_id
     WHERE apl.area_id = ?
     ORDER BY pr.sort_order, pr.id`,
    area.id,
  );
  return {
    ...area,
    isIntegration: Boolean(area.isIntegration),
    packageCount: Number(area.packageCount),
    leaders,
    projectLeads,
    projectMembers,
  };
}
