import "server-only";

import { all, db, one, run, transaction } from "./db";
import { ROLES, type PackageStatus, type Role } from "./constants";
import { canManageAreas, isAdmin } from "./permissions";
import { canEditPackageResponsibility, canManagePackageArea, canManageProjectWorkflowForProject, getProjectSoftwareManagerIds, isAreaLeader, isAreaProjectLeadForProject } from "./access";
import { DEFAULT_PROJECT_STAGE, isProjectStage, PROJECT_STAGE_META, type ProjectStage } from "./project-stage";
import { assert } from "./domain-error";
import { isStandardPackageCode, packageIdentity } from "./package-identity";
import type { SessionUser } from "./types";
import { refreshProjectTrialReadiness } from "./trial-readiness";
import { backfillTrialTransferRequests, refreshScopedPendingVersions } from "./transfer-requests";
import { LEGACY_VERSION_IMPORT_SQL, STANDALONE_IMPORTED_VERSION_SQL } from "./version-scope";

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

export function getNodeApproverRemovalBlocker(userId: number, primaryApproverId: number | null, approverCount: number) {
  if (userId === primaryApproverId) {
    return { message: "主审批人不能从审批人范围移除，请先修改节点审批人。", target: "primary" } as const;
  }
  if (approverCount <= 1) {
    return { message: "节点至少需要保留一个审批人。", target: "range" } as const;
  }
  return null;
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

export function getSettingsPackageReferences(scope: { projectId: number } | { nodeId: number } | { enabledOwnerId: number }) {
  type Reference = { id: number; name: string; code: string; areaId: number | null; areaName: string | null };
  const packages = `SELECT DISTINCT p.id, p.name, p.code, p.area_id AS areaId, a.name AS areaName
    FROM packages p LEFT JOIN areas a ON a.id = p.area_id`;
  if ("enabledOwnerId" in scope) {
    return all<Reference>(`${packages} WHERE p.owner_id = ? AND p.is_active = 1 ORDER BY p.code, p.id`, scope.enabledOwnerId);
  }
  const [column, id] = "projectId" in scope ? ["project_id", scope.projectId] : ["node_id", scope.nodeId];
  return all<Reference>(`${packages} JOIN package_usages u ON u.package_id = p.id WHERE u.${column} = ? ORDER BY p.code, p.id`, id);
}

function countBindingHistory(column: "project_id" | "node_id", id: number) {
  return one<{ count: number }>(
    `SELECT (SELECT COUNT(*) FROM binding_requirements WHERE ${column} = ?)
            + (SELECT COUNT(*) FROM binding_tasks WHERE ${column} = ?)
            + (SELECT COUNT(*) FROM binding_flows WHERE ${column} = ?) AS count`,
    id, id, id,
  )?.count ?? 0;
}

export function getNodeDeletionBlockers(nodeId: number) {
  return {
    packages: getSettingsPackageReferences({ nodeId }),
    hasBindingHistory: countBindingHistory("node_id", nodeId) > 0,
  };
}

export function getProjectDeletionBlockers(projectId: number) {
  return {
    packages: getSettingsPackageReferences({ projectId }),
    batches: all<{ id: number; code: string }>(
      "SELECT id, code FROM integration_batches WHERE project_id = ? ORDER BY id DESC",
      projectId,
    ),
    hasBindingHistory: countBindingHistory("project_id", projectId) > 0,
  };
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

export type SavePackageInput = {
  id?: number;
  name: string;
  code: string;
  description: string;
  areaId: number | null;
  ownerId: number | null;
  isActive: boolean;
  trialOverdueDays: number;
};

type PackageBlockingVersion = { id: number; version: string; status: PackageStatus; isStandaloneImport: number };

export function getPackageDeactivationBlockingVersions(packageId: number) {
  return all<PackageBlockingVersion>(
    `SELECT pv.id, pv.version, pv.status, (${STANDALONE_IMPORTED_VERSION_SQL}) AS isStandaloneImport
     FROM package_versions pv WHERE pv.package_id = ? AND pv.status != 'FORMAL'
     ORDER BY pv.submitted_at DESC, pv.id DESC`,
    packageId,
  );
}

export function savePackage(actor: SessionUser, input: SavePackageInput): number {
  const existingPackage = input.id
    ? one<{ id: number; area_id: number | null; name: string; code: string }>("SELECT id, area_id, name, code FROM packages WHERE id = ?", input.id)
    : null;
  if (input.id) {
    assert(existingPackage, "软件包不存在。", "NOT_FOUND");
    assert(
      canManagePackageArea(actor, existingPackage.area_id),
      "只有责任田主管或系统管理员可以维护该软件包。",
      "FORBIDDEN",
    );
    assert(
      input.areaId === existingPackage.area_id || isAdmin(actor),
      "只有系统管理员可以调整软件包所属责任田。",
      "FORBIDDEN",
    );
  } else {
    assert(
      canManagePackageArea(actor, input.areaId),
      "只有责任田主管或系统管理员可以在该责任田下新建软件包。",
      "FORBIDDEN",
    );
  }
  const name = input.name.trim();
  const code = input.code.trim().toUpperCase();
  const current = existingPackage ? packageIdentity(existingPackage) : null;
  const unchangedCode = current?.code.toUpperCase() === code;
  assert(name.length >= 2, "软件包名称至少需要 2 个字符。");
  assert(unchangedCode || isStandardPackageCode(code), "软件包编码需要 5 位数字加 3 位字母，例如 10001OTA。");
  const identityChanged = current?.name !== name || !unchangedCode;
  const identity = existingPackage && !identityChanged ? existingPackage : { name, code };
  assert(input.ownerId, "请为软件包指定责任人。");
  assert(
    Number.isInteger(input.trialOverdueDays) && input.trialOverdueDays >= 1 && input.trialOverdueDays <= 365,
    "试制超期天数需为 1-365 的整数。",
  );
  const owner = one<{ id: number }>("SELECT id FROM users WHERE id = ? AND is_active = 1", input.ownerId);
  assert(owner, "责任人不存在或已停用。");
  if (input.areaId) {
    const area = one<{ id: number }>("SELECT id FROM areas WHERE id = ?", input.areaId);
    assert(area, "责任田不存在。");
  }
  return transaction(() => {
    if (input.id && !input.isActive) {
      const current = one<{ active: number }>("SELECT is_active AS active FROM packages WHERE id = ?", input.id);
      if (current?.active) {
        assert(getPackageDeactivationBlockingVersions(input.id).length === 0, "该软件包仍有未转正版本记录，不能停用。");
      }
    }
    if (identityChanged) {
      const matches = all<{ name: string; code: string }>(
        "SELECT name, code FROM packages WHERE id != ? AND (UPPER(code) = ? OR UPPER(name) = ?)",
        input.id ?? -1, code, code,
      );
      assert(!matches.some((pkg) => packageIdentity(pkg).code.toUpperCase() === code), "软件包编码已存在。");
    }
    let packageId = input.id ?? 0;
    if (packageId) {
      const existing = one<{ id: number }>("SELECT id FROM packages WHERE id = ?", packageId);
      assert(existing, "软件包不存在。", "NOT_FOUND");
      run(
        "UPDATE packages SET name = ?, code = ?, description = ?, area_id = ?, owner_id = ?, is_active = ?, trial_overdue_days = ? WHERE id = ?",
        identity.name,
        identity.code,
        input.description.trim(),
        input.areaId,
        input.ownerId,
        input.isActive ? 1 : 0,
        input.trialOverdueDays,
        packageId,
      );
    } else {
      const result = run(
        `INSERT INTO packages (name, code, description, area_id, owner_id, is_active, trial_overdue_days, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        identity.name,
        identity.code,
        input.description.trim(),
        input.areaId,
        input.ownerId,
        input.isActive ? 1 : 0,
        input.trialOverdueDays,
        new Date().toISOString(),
      );
      packageId = Number(result.lastInsertRowid);
    }
    audit(
      actor.id,
      input.id ? "UPDATE_PACKAGE" : "CREATE_PACKAGE",
      "PACKAGE",
      packageId,
      `${input.id ? "更新" : "创建"}软件包：${code} · ${name}`,
    );
    return packageId;
  });
}


type LegacyVersionMetadataInput = {
  changeSummary: string;
  archiveUrl: string;
  buildUrl: string;
  trialFormNo: string;
  trialReleasedAt: string;
  formFlowNo: string;
  formalReleasedAt: string;
};

export type ImportLegacyVersionInput = LegacyVersionMetadataInput & {
  packageId: number;
  version: string;
  status: "TRIAL" | "FORMAL";
};

function legacyVersionMetadata(input: LegacyVersionMetadataInput, status: ImportLegacyVersionInput["status"]) {
  const changeSummary = input.changeSummary.trim();
  const archiveUrl = input.archiveUrl.trim();
  const buildUrl = input.buildUrl.trim();
  const trialFormNo = input.trialFormNo.trim() || null;
  const formFlowNo = input.formFlowNo.trim() || null;
  assert(changeSummary.length >= 2, "请填写版本说明/修复内容。");
  assert(/^https?:\/\//i.test(archiveUrl), "归档链接必须以 http:// 或 https:// 开头。");
  assert(/^https?:\/\//i.test(buildUrl), "构建地址必须以 http:// 或 https:// 开头。");
  const toIso = (value: string, label: string) => {
    const parsed = value ? new Date(value) : null;
    assert(parsed && !Number.isNaN(parsed.getTime()), `请填写有效的${label}。`);
    return parsed.toISOString();
  };
  let formalReleasedAt: string | null = null;
  if (status === "FORMAL") {
    assert(formFlowNo && formFlowNo.length >= 3, "请填写转正电子流。");
    formalReleasedAt = toIso(input.formalReleasedAt, "转正日期");
  } else {
    assert(trialFormNo && trialFormNo.length >= 3, "请填写试制电子流。");
  }

  return {
    changeSummary,
    archiveUrl,
    buildUrl,
    trialFormNo,
    trialReleasedAt: trialFormNo ? toIso(input.trialReleasedAt, "试制发布日期") : null,
    formFlowNo,
    formalReleasedAt,
  };
}

export function importLegacyVersion(actor: SessionUser, input: ImportLegacyVersionInput): number {
  const pkg = one<{ id: number; name: string; code: string; area_id: number | null }>(
    "SELECT id, name, code, area_id FROM packages WHERE id = ?",
    input.packageId,
  );
  assert(pkg, "软件包不存在。", "NOT_FOUND");
  assert(
    canManagePackageArea(actor, pkg.area_id),
    "只有责任田主管或系统管理员可以导入历史版本。",
    "FORBIDDEN",
  );
  const version = input.version.trim();
  assert(version.length >= 1 && version.length <= 40, "版本号需为 1-40 个字符。");
  const duplicate = one<{ id: number }>(
    "SELECT id FROM package_versions WHERE package_id = ? AND UPPER(version) = UPPER(?)",
    input.packageId,
    version,
  );
  assert(!duplicate, "该软件包已存在相同版本号。");
  const metadata = legacyVersionMetadata(input, input.status);
  const timestamp = new Date().toISOString();
  return transaction(() => {
    const result = run(
      `INSERT INTO package_versions
        (package_id, version, change_summary, archive_url, build_url, status, submitted_by, submitted_at,
         trial_form_no, trial_released_at, formal_released_at, form_flow_no, release_mode,
         binding_mode, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INTEGRATION', 'SKIPPED', ?)`,
      input.packageId,
      version,
      metadata.changeSummary,
      metadata.archiveUrl,
      metadata.buildUrl,
      input.status,
      actor.id,
      timestamp,
      metadata.trialFormNo,
      metadata.trialReleasedAt,
      metadata.formalReleasedAt,
      metadata.formFlowNo,
      timestamp,
    );
    const versionId = Number(result.lastInsertRowid);
    audit(
      actor.id,
      "IMPORT_LEGACY_VERSION",
      "PACKAGE_VERSION",
      versionId,
      `导入历史版本：${pkg.name} ${version}（${input.status === "FORMAL" ? "已转正" : "试制中"}）`,
    );
    return versionId;
  });
}

// A referenced version may already be in a batch snapshot or binding history.
const CORRECTABLE_LEGACY_VERSION_SQL = `
  pv.status IN ('TRIAL', 'FORMAL')
  AND NOT EXISTS (SELECT 1 FROM version_transfer_requests r WHERE r.package_version_id = pv.id)
  AND NOT EXISTS (SELECT 1 FROM batch_items bi WHERE bi.package_version_id = pv.id)
  AND NOT EXISTS (SELECT 1 FROM binding_requirements br WHERE br.package_version_id = pv.id)
  AND NOT EXISTS (SELECT 1 FROM binding_tasks bt WHERE bt.package_version_id = pv.id)
  AND NOT EXISTS (SELECT 1 FROM binding_flows bf WHERE bf.package_version_id = pv.id)
  AND NOT EXISTS (SELECT 1 FROM trial_risk_admissions a WHERE a.package_version_id = pv.id)
  AND NOT EXISTS (SELECT 1 FROM risk_reviews rr WHERE rr.package_version_id = pv.id)
  AND NOT EXISTS (SELECT 1 FROM formal_reviews fr WHERE fr.package_version_id = pv.id)
`;

export function getImportedPackageVersions(packageId: number) {
  return all<{ id: number; version: string; status: PackageStatus; canCorrect: number }>(
    `SELECT pv.id, pv.version, pv.status, (${CORRECTABLE_LEGACY_VERSION_SQL}) AS canCorrect
     FROM package_versions pv
     WHERE pv.package_id = ? AND ${LEGACY_VERSION_IMPORT_SQL}
     ORDER BY pv.submitted_at DESC, pv.id DESC`,
    packageId,
  );
}

type CorrectableLegacyVersion = ReturnType<typeof legacyVersionMetadata> & {
  id: number;
  version: string;
  status: ImportLegacyVersionInput["status"];
  packageCode: string;
  packageName: string;
  updatedAt: string;
};

export function getLegacyVersionForCorrection(packageId: number, versionId: number) {
  return one<CorrectableLegacyVersion>(
    `SELECT pv.id, pv.version, pv.status, p.code AS packageCode, p.name AS packageName,
            pv.change_summary AS changeSummary, pv.archive_url AS archiveUrl, pv.build_url AS buildUrl,
            pv.trial_form_no AS trialFormNo, pv.trial_released_at AS trialReleasedAt,
            pv.form_flow_no AS formFlowNo, pv.formal_released_at AS formalReleasedAt, pv.updated_at AS updatedAt
     FROM package_versions pv JOIN packages p ON p.id = pv.package_id
     WHERE pv.id = ? AND pv.package_id = ? AND ${LEGACY_VERSION_IMPORT_SQL} AND ${CORRECTABLE_LEGACY_VERSION_SQL}`,
    versionId,
    packageId,
  );
}

export function correctLegacyVersion(
  actor: SessionUser,
  packageId: number,
  versionId: number,
  input: LegacyVersionMetadataInput & { expectedUpdatedAt: string; reason: string },
) {
  assert(isAdmin(actor), "只有系统管理员可以更正历史版本。", "FORBIDDEN");
  const reason = input.reason.trim();
  assert(reason.length >= 5 && reason.length <= 1000, "更正原因需为 5–1000 个字符。");

  transaction(() => {
    const current = getLegacyVersionForCorrection(packageId, versionId);
    assert(current, "当前版本无法更正。仅支持尚未被流程引用的历史补录版本。");
    assert(input.expectedUpdatedAt === current.updatedAt, "版本资料已更新，请刷新后再提交。");
    const before = {
      changeSummary: current.changeSummary,
      archiveUrl: current.archiveUrl,
      buildUrl: current.buildUrl,
      trialFormNo: current.trialFormNo,
      trialReleasedAt: current.trialReleasedAt,
      formFlowNo: current.formFlowNo,
      formalReleasedAt: current.formalReleasedAt,
    };
    const after = legacyVersionMetadata(input, current.status);
    if (current.status === "TRIAL") after.formFlowNo = current.formFlowNo;
    assert(JSON.stringify(before) !== JSON.stringify(after), "版本资料没有变化。");
    const previousTimestamp = Date.parse(current.updatedAt);
    const timestamp = new Date(Math.max(Date.now(), Number.isFinite(previousTimestamp) ? previousTimestamp + 1 : 0)).toISOString();
    run(
      `UPDATE package_versions
       SET change_summary = ?, archive_url = ?, build_url = ?, trial_form_no = ?, trial_released_at = ?,
           form_flow_no = ?, formal_released_at = ?, updated_at = ?
       WHERE id = ?`,
      after.changeSummary,
      after.archiveUrl,
      after.buildUrl,
      after.trialFormNo,
      after.trialReleasedAt,
      after.formFlowNo,
      after.formalReleasedAt,
      timestamp,
      versionId,
    );
    audit(actor.id, "CORRECT_LEGACY_VERSION", "PACKAGE_VERSION", versionId,
      JSON.stringify({ packageId, version: current.version, status: current.status, reason, before, after }));
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
    canEditPackageResponsibility(actor, pkg.area_id),
    "只有责任田主管、项目负责人或系统管理员可以修改软件包责任信息。",
    "FORBIDDEN",
  );
  assert(input.ownerId, "请为软件包指定责任人。");
  const owner = one<{ id: number }>(
    "SELECT id FROM users WHERE id = ? AND is_active = 1",
    input.ownerId,
  );
  assert(owner, "责任人不存在或已停用。");
  transaction(() => {
    if (pkg.is_active === 1 && !input.isActive) {
      assert(getPackageDeactivationBlockingVersions(packageId).length === 0, "该软件包仍有未转正版本记录，不能停用。");
    }
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

export function getPackageUsageBlockingVersions(packageId: number) {
  return all<Pick<PackageBlockingVersion, "id" | "version" | "status">>(
    `SELECT pv.id, pv.version, pv.status FROM package_versions pv
     WHERE pv.package_id = ? AND pv.status IN ('TRIAL', 'PENDING_FORMAL')
       AND NOT ${STANDALONE_IMPORTED_VERSION_SQL}
     ORDER BY pv.submitted_at DESC, pv.id DESC`,
    packageId,
  );
}

export function savePackageUsages(actor: SessionUser, packageId: number, nodeIds: number[]) {
  const uniqueNodeIds = [...new Set(nodeIds)];
  return transaction(() => {
    const pkg = one<{ id: number; name: string; area_id: number | null }>(
      "SELECT id, name, area_id FROM packages WHERE id = ?",
      packageId,
    );
    assert(pkg, "软件包不存在。", "NOT_FOUND");
    assert(canManagePackageArea(actor, pkg.area_id), "只有责任田主管或系统管理员可以维护该软件包使用范围。", "FORBIDDEN");
    const [blockingVersion] = getPackageUsageBlockingVersions(packageId);
    assert(!blockingVersion, `该软件包 ${blockingVersion?.version ?? ""} 正在试制或待转正，暂不能调整项目节点范围。`);
    const nodes = uniqueNodeIds.length
      ? all<{ id: number; project_id: number }>(
        `SELECT id, project_id FROM project_nodes WHERE id IN (${uniqueNodeIds.map(() => "?").join(",")})`,
        ...uniqueNodeIds,
      )
      : [];
    assert(nodes.length === uniqueNodeIds.length, "选择的项目节点中包含无效数据。");
    run("DELETE FROM package_usages WHERE package_id = ?", packageId);
    for (const node of nodes) {
      run(
        "INSERT INTO package_usages (package_id, project_id, node_id) VALUES (?, ?, ?)",
        packageId,
        node.project_id,
        node.id,
      );
    }
    const backfilled = backfillTrialTransferRequests(db, actor.id, { packageId });
    refreshScopedPendingVersions(db, { packageId });
    audit(
      actor.id,
      "UPDATE_PACKAGE_USAGE",
      "PACKAGE",
      packageId,
      `更新 ${pkg.name} 使用范围，共 ${nodes.length} 个项目测试节点`,
    );
    return backfilled.length;
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
  transaction(() => {
    if (!active) {
      assert(getSettingsPackageReferences({ enabledOwnerId: userId }).length === 0, "该人员仍负责启用中的软件包，请先转移责任人。");
    }
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
