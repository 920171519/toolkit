import "server-only";

import { all, one } from "./db";

const assignmentTables = ["area_leaders", "area_project_leads", "area_project_members"] as const;
const membershipRowsSql = assignmentTables
  .map((table) => `SELECT user_id, area_id FROM ${table}`)
  .join("\n      UNION\n      ");
const assignedAreaIdsSql = assignmentTables
  .map((table) => `SELECT area_id AS areaId FROM ${table} WHERE user_id = ?`)
  .join("\n     UNION ");
const areaMembershipMatchSql = assignmentTables
  .map((table) => `SELECT 1 FROM ${table} WHERE user_id = ? AND area_id = ?`)
  .join("\n     UNION ALL ");

export function getAreaMemberships(userId?: number) {
  return all<{ userId: number; areaId: number; name: string }>(
    `WITH memberships AS (
      ${membershipRowsSql}
    )
    SELECT m.user_id AS userId, m.area_id AS areaId, a.name
    FROM memberships m JOIN areas a ON a.id = m.area_id
    ${userId === undefined ? "" : "WHERE m.user_id = ?"}
    ORDER BY a.name, a.id`,
    ...(userId === undefined ? [] : [userId]),
  );
}

export function getAssignedAreaIds(userId: number): number[] {
  return all<{ areaId: number }>(assignedAreaIdsSql, ...assignmentTables.map(() => userId)).map(({ areaId }) => areaId);
}

export function hasAreaMembership(userId: number, areaId: number): boolean {
  return one(`${areaMembershipMatchSql} LIMIT 1`, ...assignmentTables.flatMap(() => [userId, areaId])) !== undefined;
}
