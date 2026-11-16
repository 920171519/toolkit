import "server-only";

import { all, one, run, transaction } from "./db";
import { ROLES, type Role } from "./constants";
import { canManageConfig, canManageAreas, isAdmin } from "./permissions";
import { isAreaLeader, isAreaProjectLead, isAreaProjectLeadForProject } from "./access";
import { assert } from "./services";
import type { SessionUser } from "./types";

function audit(actorId: number, action: string, entityType: string, entityId: number | null, detail: string) {
  run(
    "INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    actorId,
    action,
    entityType,
    entityId,
    detail,
    new Date().toISOString(),
  );
}

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
  const existing = one<{ id: number }>(
    "SELECT id FROM area_project_leads WHERE area_id = ? AND project_id = ?",
    areaId,
    projectId,
  );
  assert(!existing, "该项目在此责任田下已经设置了负责人，请先移除后再重新指定。");
  transaction(() => {
    run(
      "INSERT INTO area_project_leads (area_id, project_id, user_id, created_at) VALUES (?, ?, ?, ?)",
      areaId,
      projectId,
      userId,
      new Date().toISOString(),
    );
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

export type SaveProjectInput = {
  id?: number;
  name: string;
  code: string;
  description: string;
  pmUserId: number | null;
  softwareManagerId: number | null;
  status: "ACTIVE" | "PAUSED" | "ARCHIVED";
  sortOrder?: number | null;
};

export function saveProject(actor: SessionUser, input: SaveProjectInput): number {
  assert(canManageConfig(actor), "只有软件经理或系统管理员可以维护项目。", "FORBIDDEN");
  assert(input.name.trim().length >= 2, "项目名称至少需要 2 个字符。");
  assert(/^[A-Za-z0-9_-]{2,20}$/.test(input.code.trim()), "项目编码需为 2-20 位字母、数字、下划线或中划线。");
  const duplicateName = one<{ id: number }>(
    "SELECT id FROM projects WHERE LOWER(name) = LOWER(?) AND id != ?",
    input.name.trim(),
    input.id ?? -1,
  );
  assert(!duplicateName, "项目名称已存在。");
  const duplicateCode = one<{ id: number }>(
    "SELECT id FROM projects WHERE UPPER(code) = UPPER(?) AND id != ?",
    input.code.trim(),
    input.id ?? -1,
  );
  assert(!duplicateCode, "项目编码已存在。");
  assert(input.pmUserId, "请为项目指定 PM。");
  const pm = one<{ id: number }>(
    "SELECT id FROM users WHERE id = ? AND is_active = 1",
    input.pmUserId,
  );
  assert(pm, "选择的 PM 不存在或已停用。");
  assert(input.softwareManagerId, "请为项目指定软件经理。");
  const softwareManager = one<{ id: number; role: Role }>(
    "SELECT id, role FROM users WHERE id = ? AND is_active = 1",
    input.softwareManagerId,
  );
  assert(softwareManager, "选择的软件经理不存在或已停用。");
  assert(
    softwareManager.role === "SOFTWARE_MANAGER",
    "选择的软件经理必须具有“软件经理”角色。",
  );
  assert(["ACTIVE", "PAUSED", "ARCHIVED"].includes(input.status), "项目状态无效。");
  return transaction(() => {
    let projectId = input.id ?? 0;
    if (projectId) {
      const existing = one<{ id: number; sort_order: number }>("SELECT id, sort_order FROM projects WHERE id = ?", projectId);
      assert(existing, "项目不存在。", "NOT_FOUND");
      const sortOrder = input.sortOrder == null ? existing.sort_order : Math.max(0, Math.floor(input.sortOrder));
      run(
        `UPDATE projects
         SET name = ?, code = ?, description = ?, pm_user_id = ?, software_manager_id = ?,
             status = ?, sort_order = ?
         WHERE id = ?`,
        input.name.trim(),
        input.code.trim().toUpperCase(),
        input.description.trim(),
        input.pmUserId,
        input.softwareManagerId,
        input.status,
        sortOrder,
        projectId,
      );
    } else {
      const maxOrder = one<{ value: number }>("SELECT COALESCE(MAX(sort_order), 0) AS value FROM projects");
      const sortOrder = input.sortOrder == null
        ? Number(maxOrder?.value ?? 0) + 1
        : Math.max(0, Math.floor(input.sortOrder));
      const result = run(
        `INSERT INTO projects
          (name, code, description, pm_user_id, software_manager_id, status, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        input.name.trim(),
        input.code.trim().toUpperCase(),
        input.description.trim(),
        input.pmUserId,
        input.softwareManagerId,
        input.status,
        sortOrder,
        new Date().toISOString(),
      );
      projectId = Number(result.lastInsertRowid);
    }
    audit(
      actor.id,
      input.id ? "UPDATE_PROJECT" : "CREATE_PROJECT",
      "PROJECT",
      projectId,
      `${input.id ? "更新" : "创建"}项目：${input.name.trim()}`,
    );
    return projectId;
  });
}

export type NodeOwnersInput = {
  bindingOwnerId: number | null;
  bindingApproverId: number | null;
  requiredBindingCount: number;
};

function validateNodeOwners(input: NodeOwnersInput) {
  assert(input.bindingOwnerId, "请选择设备条码绑定验证责任人。");
  assert(input.bindingApproverId, "请选择绑定电子流审批责任人。");
  assert(
    input.bindingOwnerId !== input.bindingApproverId,
    "绑定验证责任人与绑定电子流审批人不能是同一个人。",
  );
  assert(
    Number.isInteger(input.requiredBindingCount) &&
      input.requiredBindingCount >= 1 &&
      input.requiredBindingCount <= 20,
    "单节点绑定通过数量需为 1-20 的整数。",
  );
  const owner = one<{ id: number }>(
    "SELECT id FROM users WHERE id = ? AND is_active = 1",
    input.bindingOwnerId,
  );
  assert(owner, "绑定验证责任人不存在或已停用。");
  const approver = one<{ id: number }>(
    "SELECT id FROM users WHERE id = ? AND is_active = 1",
    input.bindingApproverId,
  );
  assert(approver, "绑定审批责任人不存在或已停用。");
}

export function addProjectNode(
  actor: SessionUser,
  projectId: number,
  name: string,
  description: string,
  owners: NodeOwnersInput,
) {
  assert(canManageConfig(actor), "只有软件经理或系统管理员可以维护项目节点。", "FORBIDDEN");
  assert(name.trim().length >= 1 && name.trim().length <= 20, "节点名称需为 1-20 个字符。");
  const project = one<{ id: number; name: string }>("SELECT id, name FROM projects WHERE id = ?", projectId);
  assert(project, "项目不存在。", "NOT_FOUND");
  validateNodeOwners(owners);
  const duplicate = one<{ id: number }>(
    "SELECT id FROM project_nodes WHERE project_id = ? AND LOWER(name) = LOWER(?)",
    projectId,
    name.trim(),
  );
  assert(!duplicate, "该项目下已存在同名测试节点。");
  const maxOrder = one<{ value: number }>(
    "SELECT COALESCE(MAX(sort_order), 0) AS value FROM project_nodes WHERE project_id = ?",
    projectId,
  );
  transaction(() => {
    const result = run(
      `INSERT INTO project_nodes
        (project_id, name, description, binding_owner_id, binding_approver_id, required_binding_count, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      projectId,
      name.trim(),
      description.trim(),
      owners.bindingOwnerId,
      owners.bindingApproverId,
      owners.requiredBindingCount,
      Number(maxOrder?.value ?? 0) + 1,
    );
    run(
      "INSERT OR IGNORE INTO project_node_approvers (node_id, user_id, created_at) VALUES (?, ?, ?)",
      Number(result.lastInsertRowid),
      owners.bindingApproverId,
      new Date().toISOString(),
    );
    audit(
      actor.id,
      "ADD_PROJECT_NODE",
      "PROJECT",
      projectId,
      `为 ${project.name} 新增测试节点 ${name.trim()}，并配置绑定责任人与审批人`,
    );
    return result;
  });
}

export function updateProjectNode(
  actor: SessionUser,
  nodeId: number,
  name: string,
  description: string,
  owners: NodeOwnersInput,
) {
  assert(canManageConfig(actor), "只有软件经理或系统管理员可以维护项目节点。", "FORBIDDEN");
  assert(name.trim().length >= 1 && name.trim().length <= 20, "节点名称需为 1-20 个字符。");
  validateNodeOwners(owners);
  const node = one<{ id: number; project_id: number; project_name: string; old_name: string }>(
    `SELECT n.id, n.project_id, n.name AS old_name, p.name AS project_name
     FROM project_nodes n JOIN projects p ON p.id = n.project_id WHERE n.id = ?`,
    nodeId,
  );
  assert(node, "项目节点不存在。", "NOT_FOUND");
  const duplicate = one<{ id: number }>(
    "SELECT id FROM project_nodes WHERE project_id = ? AND LOWER(name) = LOWER(?) AND id != ?",
    node.project_id,
    name.trim(),
    nodeId,
  );
  assert(!duplicate, "该项目下已存在同名测试节点。");
  transaction(() => {
    run(
      `UPDATE project_nodes
       SET name = ?, description = ?, binding_owner_id = ?, binding_approver_id = ?, required_binding_count = ?
       WHERE id = ?`,
      name.trim(),
      description.trim(),
      owners.bindingOwnerId,
      owners.bindingApproverId,
      owners.requiredBindingCount,
      nodeId,
    );
    run(
      "INSERT OR IGNORE INTO project_node_approvers (node_id, user_id, created_at) VALUES (?, ?, ?)",
      nodeId,
      owners.bindingApproverId,
      new Date().toISOString(),
    );
    audit(
      actor.id,
      "UPDATE_PROJECT_NODE",
      "PROJECT",
      node.project_id,
      `更新 ${node.project_name} 节点 ${node.old_name} 的绑定责任人、审批人与通过数量`,
    );
  });
}

export function addProjectNodeApprover(actor: SessionUser, nodeId: number, userId: number) {
  assert(canManageConfig(actor), "只有软件经理或系统管理员可以维护节点审批人范围。", "FORBIDDEN");
  const node = one<{ id: number; name: string; project_id: number; project_name: string }>(
    `SELECT n.id, n.name, n.project_id, p.name AS project_name
     FROM project_nodes n JOIN projects p ON p.id = n.project_id WHERE n.id = ?`,
    nodeId,
  );
  assert(node, "项目节点不存在。", "NOT_FOUND");
  const person = one<{ id: number; name: string }>("SELECT id, name FROM users WHERE id = ? AND is_active = 1", userId);
  assert(person, "审批人不存在或已停用。");
  const existing = one<{ id: number }>(
    "SELECT id FROM project_node_approvers WHERE node_id = ? AND user_id = ?",
    nodeId,
    userId,
  );
  assert(!existing, "该人员已在此节点的审批人范围内。");
  transaction(() => {
    run(
      "INSERT INTO project_node_approvers (node_id, user_id, created_at) VALUES (?, ?, ?)",
      nodeId,
      userId,
      new Date().toISOString(),
    );
    audit(actor.id, "ADD_NODE_APPROVER", "PROJECT", node.project_id, `${node.project_name}/${node.name} 添加绑定电子流审批人 ${person.name}`);
  });
}

export function removeProjectNodeApprover(actor: SessionUser, assignmentId: number) {
  assert(canManageConfig(actor), "只有软件经理或系统管理员可以维护节点审批人范围。", "FORBIDDEN");
  const assignment = one<{
    id: number;
    node_id: number;
    user_id: number;
    node_name: string;
    project_id: number;
    project_name: string;
    user_name: string;
    primary_approver_id: number | null;
  }>(
    `SELECT pna.id, pna.node_id, pna.user_id, n.name AS node_name, n.project_id,
            p.name AS project_name, u.name AS user_name, n.binding_approver_id AS primary_approver_id
     FROM project_node_approvers pna
     JOIN project_nodes n ON n.id = pna.node_id
     JOIN projects p ON p.id = n.project_id
     JOIN users u ON u.id = pna.user_id
     WHERE pna.id = ?`,
    assignmentId,
  );
  assert(assignment, "节点审批人配置不存在。", "NOT_FOUND");
  assert(assignment.user_id !== assignment.primary_approver_id, "主审批人不能从审批人范围移除，请先修改节点审批人。");
  const count = one<{ count: number }>(
    "SELECT COUNT(*) AS count FROM project_node_approvers WHERE node_id = ?",
    assignment.node_id,
  );
  assert(Number(count?.count ?? 0) > 1, "节点至少需要保留一个审批人。");
  transaction(() => {
    run("DELETE FROM project_node_approvers WHERE id = ?", assignmentId);
    audit(actor.id, "REMOVE_NODE_APPROVER", "PROJECT", assignment.project_id, `${assignment.project_name}/${assignment.node_name} 移除绑定电子流审批人 ${assignment.user_name}`);
  });
}

export function deleteProjectNode(actor: SessionUser, nodeId: number) {
  assert(canManageConfig(actor), "只有软件经理或系统管理员可以维护项目节点。", "FORBIDDEN");
  const node = one<{ id: number; name: string; project_id: number; project_name: string }>(
    `SELECT n.id, n.name, n.project_id, p.name AS project_name
     FROM project_nodes n JOIN projects p ON p.id = n.project_id WHERE n.id = ?`,
    nodeId,
  );
  assert(node, "项目节点不存在。", "NOT_FOUND");
  const usageCount = one<{ count: number }>(
    "SELECT COUNT(*) AS count FROM package_usages WHERE node_id = ?",
    nodeId,
  );
  assert(
    Number(usageCount?.count ?? 0) === 0,
    "该节点已被软件包使用，请先调整软件包使用范围后再删除节点。",
  );
  const bindingCount = one<{ count: number }>(
    "SELECT COUNT(*) AS count FROM binding_requirements WHERE node_id = ?",
    nodeId,
  );
  assert(Number(bindingCount?.count ?? 0) === 0, "该节点存在绑定验证历史，不能删除。");
  transaction(() => {
    run("DELETE FROM project_nodes WHERE id = ?", nodeId);
    audit(actor.id, "DELETE_PROJECT_NODE", "PROJECT", node.project_id, `删除 ${node.project_name} 的节点 ${node.name}`);
  });
}

export function deleteProject(actor: SessionUser, projectId: number) {
  assert(canManageConfig(actor), "只有软件经理或系统管理员可以维护项目。", "FORBIDDEN");
  const project = one<{ id: number; name: string }>("SELECT id, name FROM projects WHERE id = ?", projectId);
  assert(project, "项目不存在。", "NOT_FOUND");
  const usageCount = one<{ count: number }>(
    "SELECT COUNT(*) AS count FROM package_usages WHERE project_id = ?",
    projectId,
  );
  assert(Number(usageCount?.count ?? 0) === 0, "项目仍关联软件包使用范围，不能删除。请先将项目归档。");
  transaction(() => {
    run("DELETE FROM projects WHERE id = ?", projectId);
    audit(actor.id, "DELETE_PROJECT", "PROJECT", projectId, `删除项目：${project.name}`);
  });
}

export type SavePackageInput = {
  id?: number;
  name: string;
  code: string;
  description: string;
  areaId: number | null;
  ownerId: number | null;
  isActive: boolean;
};

export function savePackage(actor: SessionUser, input: SavePackageInput): number {
  assert(canManageConfig(actor), "只有软件经理或系统管理员可以维护软件包。", "FORBIDDEN");
  assert(input.name.trim().length >= 2, "软件包名称至少需要 2 个字符。");
  assert(/^[A-Za-z0-9_-]{2,24}$/.test(input.code.trim()), "软件包编码需为 2-24 位字母、数字、下划线或中划线。");
  assert(input.ownerId, "请为软件包指定责任人。");
  const duplicate = one<{ id: number }>(
    "SELECT id FROM packages WHERE UPPER(code) = UPPER(?) AND id != ?",
    input.code.trim(),
    input.id ?? -1,
  );
  assert(!duplicate, "软件包编码已存在。");
  const owner = one<{ id: number }>("SELECT id FROM users WHERE id = ? AND is_active = 1", input.ownerId);
  assert(owner, "责任人不存在或已停用。");
  if (input.areaId) {
    const area = one<{ id: number }>("SELECT id FROM areas WHERE id = ?", input.areaId);
    assert(area, "责任田不存在。");
  }
  if (input.id && !input.isActive) {
    const activeVersion = one<{ version: string }>(
      "SELECT version FROM package_versions WHERE package_id = ? AND status != 'FORMAL' LIMIT 1",
      input.id,
    );
    assert(!activeVersion, "该软件包仍有在途版本，不能停用。");
  }
  return transaction(() => {
    let packageId = input.id ?? 0;
    if (packageId) {
      const existing = one<{ id: number }>("SELECT id FROM packages WHERE id = ?", packageId);
      assert(existing, "软件包不存在。", "NOT_FOUND");
      run(
        "UPDATE packages SET name = ?, code = ?, description = ?, area_id = ?, owner_id = ?, is_active = ? WHERE id = ?",
        input.name.trim(),
        input.code.trim().toUpperCase(),
        input.description.trim(),
        input.areaId,
        input.ownerId,
        input.isActive ? 1 : 0,
        packageId,
      );
    } else {
      const result = run(
        `INSERT INTO packages (name, code, description, area_id, owner_id, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        input.name.trim(),
        input.code.trim().toUpperCase(),
        input.description.trim(),
        input.areaId,
        input.ownerId,
        input.isActive ? 1 : 0,
        new Date().toISOString(),
      );
      packageId = Number(result.lastInsertRowid);
    }
    audit(
      actor.id,
      input.id ? "UPDATE_PACKAGE" : "CREATE_PACKAGE",
      "PACKAGE",
      packageId,
      `${input.id ? "更新" : "创建"}软件包：${input.name.trim()}`,
    );
    return packageId;
  });
}


export type UpdatePackageResponsibilityInput = {
  ownerId: number | null;
  description: string;
  isActive: boolean;
};

export function updatePackageResponsibility(
  actor: SessionUser,
  packageId: number,
  input: UpdatePackageResponsibilityInput,
) {
  const pkg = one<{
    id: number;
    name: string;
    area_id: number | null;
    owner_id: number | null;
    is_active: number;
  }>(
    "SELECT id, name, area_id, owner_id, is_active FROM packages WHERE id = ?",
    packageId,
  );
  assert(pkg, "软件包不存在。", "NOT_FOUND");
  assert(
    canManageConfig(actor) || isAreaProjectLead(actor.id, pkg.area_id),
    "只有责任田项目负责人、软件经理或系统管理员可以修改软件包责任信息。",
    "FORBIDDEN",
  );
  assert(input.ownerId, "请为软件包指定责任人。");
  const owner = one<{ id: number }>(
    "SELECT id FROM users WHERE id = ? AND is_active = 1",
    input.ownerId,
  );
  assert(owner, "责任人不存在或已停用。");
  if (pkg.is_active === 1 && !input.isActive) {
    const activeVersion = one<{ version: string }>(
      "SELECT version FROM package_versions WHERE package_id = ? AND status != 'FORMAL' LIMIT 1",
      packageId,
    );
    assert(!activeVersion, "该软件包仍有在途版本，不能停用。");
  }
  transaction(() => {
    run(
      "UPDATE packages SET owner_id = ?, description = ?, is_active = ? WHERE id = ?",
      input.ownerId,
      input.description.trim(),
      input.isActive ? 1 : 0,
      packageId,
    );
    audit(
      actor.id,
      "UPDATE_PACKAGE_RESPONSIBILITY",
      "PACKAGE",
      packageId,
      `更新 ${pkg.name} 责任信息：责任人 ${input.ownerId}，状态 ${input.isActive ? "启用" : "停用"}`,
    );
  });
}

export function savePackageUsages(actor: SessionUser, packageId: number, nodeIds: number[]) {
  assert(canManageConfig(actor), "只有软件经理或系统管理员可以维护软件包使用范围。", "FORBIDDEN");
  const pkg = one<{ id: number; name: string }>("SELECT id, name FROM packages WHERE id = ?", packageId);
  assert(pkg, "软件包不存在。", "NOT_FOUND");
  const bindingActive = one<{ version: string }>(
    "SELECT version FROM package_versions WHERE package_id = ? AND status IN ('TRIAL','PENDING_FORMAL') LIMIT 1",
    packageId,
  );
  assert(
    !bindingActive,
    `该软件包 ${bindingActive?.version ?? ""} 正在绑定验证中，暂不能调整项目节点范围。`,
  );
  const uniqueNodeIds = [...new Set(nodeIds)];
  if (uniqueNodeIds.length > 0) {
    const nodes = all<{ id: number }>(
      `SELECT id FROM project_nodes WHERE id IN (${uniqueNodeIds.map(() => "?").join(",")})`,
      ...uniqueNodeIds,
    );
    assert(nodes.length === uniqueNodeIds.length, "选择的项目节点中包含无效数据。");
  }
  transaction(() => {
    run("DELETE FROM package_usages WHERE package_id = ?", packageId);
    for (const nodeId of uniqueNodeIds) {
      const node = one<{ project_id: number }>("SELECT project_id FROM project_nodes WHERE id = ?", nodeId);
      if (node) {
        run(
          "INSERT INTO package_usages (package_id, project_id, node_id) VALUES (?, ?, ?)",
          packageId,
          node.project_id,
          nodeId,
        );
      }
    }
    audit(
      actor.id,
      "UPDATE_PACKAGE_USAGE",
      "PACKAGE",
      packageId,
      `更新 ${pkg.name} 使用范围，共 ${uniqueNodeIds.length} 个项目测试节点`,
    );
  });
}

export function updateUserRole(actor: SessionUser, userId: number, role: Role) {
  assert(isAdmin(actor), "只有系统管理员可以调整人员角色。", "FORBIDDEN");
  assert(ROLES.includes(role), "角色无效。");
  const target = one<{ id: number; name: string; role: Role; is_active: number }>(
    "SELECT id, name, role, is_active FROM users WHERE id = ?",
    userId,
  );
  assert(target, "人员不存在。", "NOT_FOUND");
  assert(target.id !== actor.id, "不能修改自己的角色，请联系其他管理员操作。");
  if (target.role === "ADMIN" && role !== "ADMIN") {
    const adminCount = one<{ count: number }>(
      "SELECT COUNT(*) AS count FROM users WHERE role = 'ADMIN' AND is_active = 1",
    );
    assert(Number(adminCount?.count ?? 0) > 1, "系统至少需要保留一名启用状态的管理员。");
  }
  transaction(() => {
    run("UPDATE users SET role = ? WHERE id = ?", role, userId);
    audit(actor.id, "UPDATE_USER_ROLE", "USER", userId, `将 ${target.name} 的角色调整为 ${role}`);
  });
}

export function setUserActive(actor: SessionUser, userId: number, active: boolean) {
  assert(isAdmin(actor), "只有系统管理员可以启用或停用人员。", "FORBIDDEN");
  const target = one<{ id: number; name: string; role: Role; is_active: number }>(
    "SELECT id, name, role, is_active FROM users WHERE id = ?",
    userId,
  );
  assert(target, "人员不存在。", "NOT_FOUND");
  assert(target.id !== actor.id, "不能停用自己的账号。");
  if (!active && target.role === "ADMIN") {
    const adminCount = one<{ count: number }>(
      "SELECT COUNT(*) AS count FROM users WHERE role = 'ADMIN' AND is_active = 1",
    );
    assert(Number(adminCount?.count ?? 0) > 1, "系统至少需要保留一名启用状态的管理员。");
  }
  if (!active) {
    const owned = one<{ count: number }>(
      "SELECT COUNT(*) AS count FROM packages WHERE owner_id = ? AND is_active = 1",
      userId,
    );
    assert(Number(owned?.count ?? 0) === 0, "该人员仍负责启用中的软件包，请先转移责任人。");
  }
  transaction(() => {
    run("UPDATE users SET is_active = ? WHERE id = ?", active ? 1 : 0, userId);
    if (!active) run("DELETE FROM sessions WHERE user_id = ?", userId);
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
