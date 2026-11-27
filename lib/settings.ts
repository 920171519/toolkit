import "server-only";

import { createAuditLogWriter } from "./audit-log";
import { db, one, run, transaction } from "./db";
import { ROLES, type Role } from "./constants";
import { canManageAreas, isAdmin } from "./permissions";
import { isAreaLeader, isAreaProjectLeadForProject } from "./access";
import { assert } from "./domain-error";
import type { SessionUser } from "./types";
import { revokeUserSessions } from "./session-store";
import { getSettingsPackageReferences } from "./settings-queries";

const audit = createAuditLogWriter(db);

export function addAreaLeader(actor: SessionUser, areaId: number, userId: number) {
  assert(canManageAreas(actor), "只有系统管理员可以设置责任田主管。", "FORBIDDEN");
  const area = one<{ id: number; name: string }>("SELECT id, name FROM areas WHERE id = ?", areaId);
  assert(area, "责任田不存在。", "NOT_FOUND");
  const person = one<{ id: number; name: string }>("SELECT id, name FROM users WHERE id = ? AND is_active = 1", userId);
  assert(person, "责任田主管不存在或已停用。");
  const existing = one<{ id: number }>("SELECT id FROM area_leaders WHERE area_id = ? AND user_id = ?", areaId, userId);
  assert(!existing, "该人员已经是此责任田主管。");
  transaction(() => {
    run("INSERT INTO area_leaders (area_id, user_id, created_at) VALUES (?, ?, ?)", areaId, userId, new Date().toISOString());
    audit(actor.id, "ADD_AREA_LEADER", "AREA", areaId, `${area.name}：设置 ${person.name} 为责任田主管`);
  });
}

export function removeAreaLeader(actor: SessionUser, leaderId: number) {
  assert(canManageAreas(actor), "只有系统管理员可以移除责任田主管。", "FORBIDDEN");
  const leader = one<{ id: number; area_id: number; area_name: string; user_name: string }>(
    `SELECT al.id, al.area_id, a.name AS area_name, u.name AS user_name
     FROM area_leaders al JOIN areas a ON a.id = al.area_id JOIN users u ON u.id = al.user_id WHERE al.id = ?`,
    leaderId,
  );
  assert(leader, "责任田主管配置不存在。", "NOT_FOUND");
  transaction(() => {
    run("DELETE FROM area_leaders WHERE id = ?", leaderId);
    audit(actor.id, "REMOVE_AREA_LEADER", "AREA", leader.area_id, `${leader.area_name}：移除责任田主管 ${leader.user_name}`);
  });
  return leader.area_id;
}

export function assignAreaProjectMember(
  actor: SessionUser,
  areaId: number,
  projectId: number,
  userId: number,
) {
  const isProjectLead = isAreaProjectLeadForProject(actor.id, areaId, projectId);
  assert(
    canManageAreas(actor) || isAreaLeader(actor.id, areaId) || isProjectLead,
    "只有责任田主管、该项目负责人或系统管理员可以添加项目成员。",
    "FORBIDDEN",
  );
  const area = one<{ id: number; name: string }>("SELECT id, name FROM areas WHERE id = ?", areaId);
  assert(area, "责任田不存在。", "NOT_FOUND");
  const project = one<{ id: number; name: string }>("SELECT id, name FROM projects WHERE id = ?", projectId);
  assert(project, "项目不存在。", "NOT_FOUND");
  const person = one<{ id: number; name: string }>("SELECT id, name FROM users WHERE id = ? AND is_active = 1", userId);
  assert(person, "项目成员不存在或已停用。");
  const existing = one<{ id: number }>(
    "SELECT id FROM area_project_members WHERE area_id = ? AND project_id = ? AND user_id = ?",
    areaId,
    projectId,
    userId,
  );
  assert(!existing, "该人员已经是此项目成员。");
  transaction(() => {
    run(
      "INSERT INTO area_project_members (area_id, project_id, user_id, created_at) VALUES (?, ?, ?, ?)",
      areaId,
      projectId,
      userId,
      new Date().toISOString(),
    );
    audit(actor.id, "ASSIGN_AREA_PROJECT_MEMBER", "AREA", areaId, `${area.name}：${project.name} 添加项目成员 ${person.name}`);
  });
}

export function removeAreaProjectMember(actor: SessionUser, memberId: number) {
  const member = one<{ id: number; area_id: number; project_id: number; area_name: string; project_name: string; user_name: string }>(
    `SELECT m.id, m.area_id, m.project_id, a.name AS area_name, p.name AS project_name, u.name AS user_name
     FROM area_project_members m JOIN areas a ON a.id = m.area_id JOIN projects p ON p.id = m.project_id
     JOIN users u ON u.id = m.user_id WHERE m.id = ?`,
    memberId,
  );
  assert(member, "项目成员配置不存在。", "NOT_FOUND");
  const isProjectLead = isAreaProjectLeadForProject(actor.id, member.area_id, member.project_id);
  assert(
    canManageAreas(actor) || isAreaLeader(actor.id, member.area_id) || isProjectLead,
    "只有责任田主管、该项目负责人或系统管理员可以移除项目成员。",
    "FORBIDDEN",
  );
  transaction(() => {
    run("DELETE FROM area_project_members WHERE id = ?", memberId);
    audit(actor.id, "REMOVE_AREA_PROJECT_MEMBER", "AREA", member.area_id, `${member.area_name}：${member.project_name} 移除项目成员 ${member.user_name}`);
  });
  return member.area_id;
}

export type SaveAreaInput = {
  id?: number;
  name: string;
  description: string;
};

export function saveArea(actor: SessionUser, input: SaveAreaInput): number {
  if (input.id) {
    assert(
      canManageAreas(actor) || isAreaLeader(actor.id, input.id),
      "只有责任田主管或系统管理员可以编辑责任田。",
      "FORBIDDEN",
    );
  } else {
    assert(canManageAreas(actor), "只有系统管理员可以新建责任田。", "FORBIDDEN");
  }
  assert(input.name.trim().length >= 2, "责任田名称至少需要 2 个字符。");
  assert(input.name.trim().length <= 30, "责任田名称不能超过 30 个字符。");
  const duplicate = one<{ id: number }>(
    "SELECT id FROM areas WHERE LOWER(name) = LOWER(?) AND id != ?",
    input.name.trim(),
    input.id ?? -1,
  );
  assert(!duplicate, "责任田名称已存在。");

  return transaction(() => {
    let areaId = input.id ?? 0;
    if (areaId) {
      const existing = one<{ id: number }>("SELECT id FROM areas WHERE id = ?", areaId);
      assert(existing, "责任田不存在。", "NOT_FOUND");
      run(
        "UPDATE areas SET name = ?, description = ? WHERE id = ?",
        input.name.trim(),
        input.description.trim(),
        areaId,
      );
    } else {
      const result = run(
        "INSERT INTO areas (name, description, created_at) VALUES (?, ?, ?)",
        input.name.trim(),
        input.description.trim(),
        new Date().toISOString(),
      );
      areaId = Number(result.lastInsertRowid);
    }
    audit(
      actor.id,
      input.id ? "UPDATE_AREA" : "CREATE_AREA",
      "AREA",
      areaId,
      `${input.id ? "更新" : "创建"}责任田：${input.name.trim()}`,
    );
    return areaId;
  });
}

export function assignAreaProjectLead(
  actor: SessionUser,
  areaId: number,
  projectId: number,
  userId: number,
  expectedAssignmentId?: number,
  expectedUserId?: number,
) {
  assert(canManageAreas(actor) || isAreaLeader(actor.id, areaId), "只有责任田主管或系统管理员可以添加项目负责人。", "FORBIDDEN");
  const area = one<{ id: number; name: string }>("SELECT id, name FROM areas WHERE id = ?", areaId);
  assert(area, "责任田不存在。", "NOT_FOUND");
  const project = one<{ id: number; name: string }>("SELECT id, name FROM projects WHERE id = ?", projectId);
  assert(project, "项目不存在。", "NOT_FOUND");
  const person = one<{ id: number; name: string }>(
    "SELECT id, name FROM users WHERE id = ? AND is_active = 1",
    userId,
  );
  assert(person, "负责人不存在或已停用。");
  transaction(() => {
    const existing = one<{ id: number; user_id: number }>(
      "SELECT id, user_id FROM area_project_leads WHERE area_id = ? AND project_id = ?",
      areaId,
      projectId,
    );
    assert(existing?.id === expectedAssignmentId && existing?.user_id === expectedUserId, "当前负责人配置已变化，请刷新后再操作。");
    if (existing) {
      run("UPDATE area_project_leads SET user_id = ? WHERE id = ?", userId, existing.id);
    } else {
      run(
        "INSERT INTO area_project_leads (area_id, project_id, user_id, created_at) VALUES (?, ?, ?, ?)",
        areaId,
        projectId,
        userId,
        new Date().toISOString(),
      );
    }
    audit(
      actor.id,
      "ASSIGN_AREA_PROJECT_LEAD",
      "AREA",
      areaId,
      `${area.name}：指定 ${person.name} 为 ${project.name} 负责人`,
    );
  });
}

export function removeAreaProjectLead(actor: SessionUser, assignmentId: number) {
  const scope = one<{ area_id: number }>("SELECT area_id FROM area_project_leads WHERE id = ?", assignmentId);
  assert(scope, "项目负责人配置不存在。", "NOT_FOUND");
  assert(canManageAreas(actor) || isAreaLeader(actor.id, scope.area_id), "只有责任田主管或系统管理员可以移除项目负责人。", "FORBIDDEN");
  const assignment = one<{
    id: number;
    area_id: number;
    area_name: string;
    project_name: string;
    user_name: string;
  }>(
    `SELECT apl.id, apl.area_id, a.name AS area_name, p.name AS project_name, u.name AS user_name
     FROM area_project_leads apl
     JOIN areas a ON a.id = apl.area_id
     JOIN projects p ON p.id = apl.project_id
     JOIN users u ON u.id = apl.user_id
     WHERE apl.id = ?`,
    assignmentId,
  );
  assert(assignment, "项目负责人配置不存在。", "NOT_FOUND");
  transaction(() => {
    run("DELETE FROM area_project_leads WHERE id = ?", assignmentId);
    audit(
      actor.id,
      "REMOVE_AREA_PROJECT_LEAD",
      "AREA",
      assignment.area_id,
      `${assignment.area_name}：移除 ${assignment.project_name} 负责人 ${assignment.user_name}`,
    );
  });
  return assignment.area_id;
}

export function deleteArea(actor: SessionUser, areaId: number) {
  assert(canManageAreas(actor), "只有系统管理员可以删除责任田。", "FORBIDDEN");
  const area = one<{ id: number; name: string }>("SELECT id, name FROM areas WHERE id = ?", areaId);
  assert(area, "责任田不存在。", "NOT_FOUND");
  const packageCount = one<{ count: number }>(
    "SELECT COUNT(*) AS count FROM packages WHERE area_id = ?",
    areaId,
  );
  assert(Number(packageCount?.count ?? 0) === 0, "该责任田下仍有软件包，请先调整软件包归属后再删除。");
  transaction(() => {
    run("DELETE FROM areas WHERE id = ?", areaId);
    audit(actor.id, "DELETE_AREA", "AREA", areaId, `删除责任田：${area.name}`);
  });
}

function assertAnotherActiveAdminRemains() {
  const adminCount = one<{ count: number }>(
    "SELECT COUNT(*) AS count FROM users WHERE role = 'ADMIN' AND is_active = 1",
  );
  assert(Number(adminCount?.count ?? 0) > 1, "系统至少需要保留一名启用状态的管理员。");
}

export function updateUserRole(actor: SessionUser, userId: number, role: Role) {
  assert(isAdmin(actor), "只有系统管理员可以调整人员角色。", "FORBIDDEN");
  assert(ROLES.includes(role), "角色无效。");
  transaction(() => {
    const target = one<{ id: number; name: string; role: Role }>(
      "SELECT id, name, role FROM users WHERE id = ?",
      userId,
    );
    assert(target, "人员不存在。", "NOT_FOUND");
    assert(target.id !== actor.id, "不能修改自己的角色，请联系其他管理员操作。");
    if (target.role === "ADMIN" && role !== "ADMIN") assertAnotherActiveAdminRemains();
    run("UPDATE users SET role = ? WHERE id = ?", role, userId);
    audit(actor.id, "UPDATE_USER_ROLE", "USER", userId, `将 ${target.name} 的角色调整为 ${role}`);
  });
}

export function setUserActive(actor: SessionUser, userId: number, active: boolean) {
  assert(isAdmin(actor), "只有系统管理员可以启用或停用人员。", "FORBIDDEN");
  transaction(() => {
    const target = one<{ id: number; name: string; role: Role }>(
      "SELECT id, name, role FROM users WHERE id = ?",
      userId,
    );
    assert(target, "人员不存在。", "NOT_FOUND");
    assert(target.id !== actor.id, "不能停用自己的账号。");
    if (!active && target.role === "ADMIN") assertAnotherActiveAdminRemains();
    if (!active) {
      assert(getSettingsPackageReferences({ enabledOwnerId: userId }).length === 0, "该人员仍负责启用中的软件包，请先转移责任人。");
    }
    run("UPDATE users SET is_active = ? WHERE id = ?", active ? 1 : 0, userId);
    if (!active) revokeUserSessions(userId);
    audit(
      actor.id,
      active ? "ENABLE_USER" : "DISABLE_USER",
      "USER",
      userId,
      `${active ? "启用" : "停用"}账号：${target.name}`,
    );
  });
}

export function saveUserProfile(actor: SessionUser, userId: number, name: string, title: string) {
  assert(isAdmin(actor), "只有系统管理员可以编辑人员资料。", "FORBIDDEN");
  assert(name.trim().length >= 2 && name.trim().length <= 30, "姓名需为 2-30 个字符。");
  const target = one<{ id: number; name: string }>("SELECT id, name FROM users WHERE id = ?", userId);
  assert(target, "人员不存在。", "NOT_FOUND");
  transaction(() => {
    run("UPDATE users SET name = ?, title = ? WHERE id = ?", name.trim(), title.trim(), userId);
    audit(actor.id, "UPDATE_USER_PROFILE", "USER", userId, `更新人员资料：${name.trim()}`);
  });
}
