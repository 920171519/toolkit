import "server-only";

import { canManageProjectWorkflowForProject, getProjectSoftwareManagerIds } from "./access";
import { createAuditLogWriter } from "./audit-log";
import { db, one, run, transaction } from "./db";
import { assert } from "./domain-error";
import { isAdmin } from "./permissions";
import { DEFAULT_PROJECT_STAGE, isProjectStage, PROJECT_STAGE_META, type ProjectStage } from "./project-stage";
import { getNodeApproverRemovalBlocker, getNodeDeletionBlockers, getProjectDeletionBlockers } from "./settings-queries";
import { backfillTrialTransferRequests, refreshScopedPendingVersions } from "./transfer-requests";
import { refreshProjectTrialReadiness } from "./trial-readiness";
import type { SessionUser } from "./types";

const audit = createAuditLogWriter(db);

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
  transaction(() => {
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
  return transaction(() => {
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
    return node.project_id;
  });
}

export function addProjectNodeApprover(actor: SessionUser, nodeId: number, userId: number) {
  return transaction(() => {
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
    run(
      "INSERT INTO project_node_approvers (node_id, user_id, created_at) VALUES (?, ?, ?)",
      nodeId,
      userId,
      new Date().toISOString(),
    );
    audit(actor.id, "ADD_NODE_APPROVER", "PROJECT", node.project_id, `${node.project_name}/${node.name} 添加绑定电子流审批人 ${person.name}`);
    return node.project_id;
  });
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
  return transaction(() => {
    const node = one<{ id: number; name: string; project_id: number; project_name: string }>(
      `SELECT n.id, n.name, n.project_id, p.name AS project_name
       FROM project_nodes n JOIN projects p ON p.id = n.project_id WHERE n.id = ?`,
      nodeId,
    );
    assert(node, "项目节点不存在。", "NOT_FOUND");
    assertProjectConfigurationAccess(actor, node.project_id);
    const blockers = getNodeDeletionBlockers(nodeId);
    assert(blockers.packages.length === 0, "该节点已被软件包使用，请先调整软件包使用范围后再删除节点。");
    assert(!blockers.hasBindingHistory, "该节点存在绑定验证历史，不能删除。");
    run("DELETE FROM project_nodes WHERE id = ?", nodeId);
    audit(actor.id, "DELETE_PROJECT_NODE", "PROJECT", node.project_id, `删除 ${node.project_name} 的节点 ${node.name}`);
    return node.project_id;
  });
}

export function deleteProject(actor: SessionUser, projectId: number) {
  transaction(() => {
    const project = one<{ id: number; name: string }>("SELECT id, name FROM projects WHERE id = ?", projectId);
    assert(project, "项目不存在。", "NOT_FOUND");
    assertProjectConfigurationAccess(actor, projectId);
    const blockers = getProjectDeletionBlockers(projectId);
    assert(blockers.packages.length === 0, "项目仍关联软件包使用范围，不能删除。请先将项目归档。");
    assert(blockers.batches.length === 0 && !blockers.hasBindingHistory, "项目存在测试批次或绑定历史，请使用归档保留记录。");
    run("DELETE FROM projects WHERE id = ?", projectId);
    audit(actor.id, "DELETE_PROJECT", "PROJECT", projectId, `删除项目：${project.name}`);
  });
}
