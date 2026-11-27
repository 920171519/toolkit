import "server-only";

import { createAuditLogWriter } from "./audit-log";
import { db, one, run, transaction } from "./db";
import { ROLES, type Role } from "./constants";
import { canManageAreas, isAdmin } from "./permissions";
import { canManageProjectWorkflowForProject, getProjectSoftwareManagerIds, isAreaLeader, isAreaProjectLeadForProject } from "./access";
import { DEFAULT_PROJECT_STAGE, isProjectStage, PROJECT_STAGE_META, type ProjectStage } from "./project-stage";
import { assert } from "./domain-error";
import type { SessionUser } from "./types";
import { refreshProjectTrialReadiness } from "./trial-readiness";
import { backfillTrialTransferRequests, refreshScopedPendingVersions } from "./transfer-requests";
import { revokeUserSessions } from "./session-store";
import {
  getNodeApproverRemovalBlocker,
  getNodeDeletionBlockers,
  getProjectDeletionBlockers,
  getSettingsPackageReferences,
} from "./settings-queries";

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

export type SaveProjectInput = {
  id?: number;
  name: string;
  code: string;
  description: string;
  pmUserIds: number[];
  softwareManagerIds?: number[];
  status: "ACTIVE" | "PAUSED" | "ARCHIVED";
  stage?: string;
  sortOrder?: number | null;
};

export function saveProject(actor: SessionUser, input: SaveProjectInput): number {
  const canAssignManagers = isAdmin(actor);
  if (input.id) {
    assertProjectConfigurationAccess(actor, input.id);
  } else {
    assert(canAssignManagers, "只有系统管理员可以新建项目。", "FORBIDDEN");
  }
  const code = input.code.trim();
  assert(input.name.trim().length >= 2, "项目名称至少需要 2 个字符。");
  assert(code.length > 0, "请填写项目编码。");
  const duplicateName = one<{ id: number }>(
    "SELECT id FROM projects WHERE LOWER(name) = LOWER(?) AND id != ?",
    input.name.trim(),
    input.id ?? -1,
  );
  assert(!duplicateName, "项目名称已存在。");
  const duplicateCode = one<{ id: number }>(
    "SELECT id FROM projects WHERE UPPER(code) = UPPER(?) AND id != ?",
    code,
    input.id ?? -1,
  );
  assert(!duplicateCode, "项目编码已存在。");
  const pmUserIds = [...new Set(input.pmUserIds)];
  const softwareManagerIds = [...new Set(input.softwareManagerIds)];
  assert(pmUserIds.length > 0, "请至少为项目指定一位 PM。");
  for (const pmUserId of pmUserIds) {
    const pm = one<{ id: number }>("SELECT id FROM users WHERE id = ? AND is_active = 1", pmUserId);
    assert(pm, "选择的 PM 不存在或已停用。");
  }
  assert(["ACTIVE", "PAUSED", "ARCHIVED"].includes(input.status), "项目状态无效。");
  const requestedStage = input.stage;
  assert(requestedStage === undefined || isProjectStage(requestedStage), "项目阶段无效。");
  return transaction(() => {
    let projectId = input.id ?? 0;
    let stage = requestedStage ?? DEFAULT_PROJECT_STAGE;
    if (canAssignManagers) {
      assert(softwareManagerIds.length > 0, "请至少为项目指定一位软件经理。");
      for (const softwareManagerId of softwareManagerIds) {
        const softwareManager = one<{ id: number }>("SELECT id FROM users WHERE id = ? AND is_active = 1", softwareManagerId);
        assert(softwareManager, "选择的软件经理不存在或已停用。");
      }
    } else {
      assertProjectConfigurationAccess(actor, projectId);
      if (input.softwareManagerIds !== undefined) {
        const currentManagers = new Set(getProjectSoftwareManagerIds(projectId));
        assert(
          softwareManagerIds.length === currentManagers.size && softwareManagerIds.every((id) => currentManagers.has(id)),
          "只有系统管理员可以变更项目软件经理。",
          "FORBIDDEN",
        );
      }
    }
    if (projectId) {
      const existing = one<{ sort_order: number; stage: ProjectStage; status: string; software_manager_id: number | null }>(
        "SELECT sort_order, stage, status, software_manager_id FROM projects WHERE id = ?", projectId,
      );
      assert(existing, "项目不存在。", "NOT_FOUND");
      stage = requestedStage ?? existing.stage;
      const sortOrder = input.sortOrder == null ? existing.sort_order : Math.max(0, Math.floor(input.sortOrder));
      run(
        `UPDATE projects
         SET name = ?, code = ?, description = ?, pm_user_id = ?, software_manager_id = ?,
             status = ?, stage = ?, sort_order = ?
         WHERE id = ?`,
        input.name.trim(),
        code,
        input.description.trim(),
        pmUserIds[0],
        canAssignManagers ? softwareManagerIds[0] : existing.software_manager_id,
        input.status,
        stage,
        sortOrder,
        projectId,
      );
      if ((existing.status === "ARCHIVED") !== (input.status === "ARCHIVED")) {
        if (existing.status === "ARCHIVED") backfillTrialTransferRequests(db, actor.id, { projectId });
        refreshScopedPendingVersions(db, { projectId });
        refreshProjectTrialReadiness(db, new Date().toISOString(), projectId);
      }
    } else {
      const maxOrder = one<{ value: number }>("SELECT COALESCE(MAX(sort_order), 0) AS value FROM projects");
      const sortOrder = input.sortOrder == null
        ? Number(maxOrder?.value ?? 0) + 1
        : Math.max(0, Math.floor(input.sortOrder));
      const result = run(
        `INSERT INTO projects
          (name, code, description, pm_user_id, software_manager_id, status, stage, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        input.name.trim(),
        code,
        input.description.trim(),
        pmUserIds[0],
        softwareManagerIds[0],
        input.status,
        stage,
        sortOrder,
        new Date().toISOString(),
      );
      projectId = Number(result.lastInsertRowid);
    }
    run("DELETE FROM project_pms WHERE project_id = ?", projectId);
    const timestamp = new Date().toISOString();
    for (const pmUserId of pmUserIds) {
      run("INSERT INTO project_pms (project_id, user_id, created_at) VALUES (?, ?, ?)", projectId, pmUserId, timestamp);
    }
    if (canAssignManagers) {
      run("DELETE FROM project_software_managers WHERE project_id = ?", projectId);
      for (const softwareManagerId of softwareManagerIds) {
        run("INSERT INTO project_software_managers (project_id, user_id, created_at) VALUES (?, ?, ?)", projectId, softwareManagerId, timestamp);
      }
    }
    audit(
      actor.id,
      input.id ? "UPDATE_PROJECT" : "CREATE_PROJECT",
      "PROJECT",
      projectId,
      `${input.id ? "更新" : "创建"}项目：${input.name.trim()}（项目阶段 ${PROJECT_STAGE_META[stage].label}）`,
    );
    return projectId;
  });
}

export type NodeOwnersInput = {
  bindingOwnerId: number | null;
  bindingApproverId: number | null;
  requiredBindingCount: number;
};

function assertProjectConfigurationAccess(actor: SessionUser, projectId: number) {
  assert(canManageProjectWorkflowForProject(actor, projectId), "只有负责本项目的软件经理或系统管理员可以修改项目配置。", "FORBIDDEN");
}

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
  assert(name.trim().length >= 1 && name.trim().length <= 20, "节点名称需为 1-20 个字符。");
  const project = one<{ id: number; name: string }>("SELECT id, name FROM projects WHERE id = ?", projectId);
  assert(project, "项目不存在。", "NOT_FOUND");
  assertProjectConfigurationAccess(actor, projectId);
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
  assert(name.trim().length >= 1 && name.trim().length <= 20, "节点名称需为 1-20 个字符。");
  const node = one<{ id: number; project_id: number; project_name: string; old_name: string }>(
    `SELECT n.id, n.project_id, n.name AS old_name, p.name AS project_name
     FROM project_nodes n JOIN projects p ON p.id = n.project_id WHERE n.id = ?`,
    nodeId,
  );
  assert(node, "项目节点不存在。", "NOT_FOUND");
  assertProjectConfigurationAccess(actor, node.project_id);
  validateNodeOwners(owners);
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
  return node.project_id;
}

export function addProjectNodeApprover(actor: SessionUser, nodeId: number, userId: number) {
  const node = one<{ id: number; name: string; project_id: number; project_name: string }>(
    `SELECT n.id, n.name, n.project_id, p.name AS project_name
     FROM project_nodes n JOIN projects p ON p.id = n.project_id WHERE n.id = ?`,
    nodeId,
  );
  assert(node, "项目节点不存在。", "NOT_FOUND");
  assertProjectConfigurationAccess(actor, node.project_id);
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
  return node.project_id;
}

export function removeProjectNodeApprover(actor: SessionUser, assignmentId: number) {
  return transaction(() => {
    const assignment = one<{
      node_id: number;
      user_id: number;
      node_name: string;
      project_id: number;
      project_name: string;
      user_name: string;
      primary_approver_id: number | null;
      approver_count: number;
    }>(
      `SELECT pna.node_id, pna.user_id, n.name AS node_name, n.project_id,
              p.name AS project_name, u.name AS user_name, n.binding_approver_id AS primary_approver_id,
              (SELECT COUNT(*) FROM project_node_approvers a WHERE a.node_id = pna.node_id) AS approver_count
       FROM project_node_approvers pna
       JOIN project_nodes n ON n.id = pna.node_id
       JOIN projects p ON p.id = n.project_id
       JOIN users u ON u.id = pna.user_id
       WHERE pna.id = ?`,
      assignmentId,
    );
    assert(assignment, "节点审批人配置不存在。", "NOT_FOUND");
    assertProjectConfigurationAccess(actor, assignment.project_id);
    const blocker = getNodeApproverRemovalBlocker(assignment.user_id, assignment.primary_approver_id, assignment.approver_count);
    assert(!blocker, blocker?.message ?? "");
    run("DELETE FROM project_node_approvers WHERE id = ?", assignmentId);
    audit(actor.id, "REMOVE_NODE_APPROVER", "PROJECT", assignment.project_id, `${assignment.project_name}/${assignment.node_name} 移除绑定电子流审批人 ${assignment.user_name}`);
    return { projectId: assignment.project_id, nodeId: assignment.node_id };
  });
}

export function deleteProjectNode(actor: SessionUser, nodeId: number) {
  const node = one<{ id: number; name: string; project_id: number; project_name: string }>(
    `SELECT n.id, n.name, n.project_id, p.name AS project_name
     FROM project_nodes n JOIN projects p ON p.id = n.project_id WHERE n.id = ?`,
    nodeId,
  );
  assert(node, "项目节点不存在。", "NOT_FOUND");
  assertProjectConfigurationAccess(actor, node.project_id);
  transaction(() => {
    const blockers = getNodeDeletionBlockers(nodeId);
    assert(blockers.packages.length === 0, "该节点已被软件包使用，请先调整软件包使用范围后再删除节点。");
    assert(!blockers.hasBindingHistory, "该节点存在绑定验证历史，不能删除。");
    run("DELETE FROM project_nodes WHERE id = ?", nodeId);
    audit(actor.id, "DELETE_PROJECT_NODE", "PROJECT", node.project_id, `删除 ${node.project_name} 的节点 ${node.name}`);
  });
  return node.project_id;
}

export function deleteProject(actor: SessionUser, projectId: number) {
  const project = one<{ id: number; name: string }>("SELECT id, name FROM projects WHERE id = ?", projectId);
  assert(project, "项目不存在。", "NOT_FOUND");
  assertProjectConfigurationAccess(actor, projectId);
  transaction(() => {
    const blockers = getProjectDeletionBlockers(projectId);
    assert(blockers.packages.length === 0, "项目仍关联软件包使用范围，不能删除。请先将项目归档。");
    assert(blockers.batches.length === 0 && !blockers.hasBindingHistory, "项目存在测试批次或绑定历史，请使用归档保留记录。");
    run("DELETE FROM projects WHERE id = ?", projectId);
    audit(actor.id, "DELETE_PROJECT", "PROJECT", projectId, `删除项目：${project.name}`);
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
