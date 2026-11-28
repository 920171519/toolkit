"use server";

import type { ActionState } from "@/lib/action-state";
import { actionUser, failure, idList, numberValue, refreshAll, successRedirect, text } from "@/lib/action-helpers";
import {
  addProjectNode,
  addProjectNodeApprover,
  deleteProject,
  deleteProjectNode,
  removeProjectNodeApprover,
  saveProject,
  updateProjectNode,
} from "@/lib/project-settings";
import { directoryHref, projectDirectoryDetailParams, projectDirectoryListParams } from "@/lib/settings-directory";

function projectSettingsHref(formData: FormData, projectId?: number, nodeId?: number) {
  const filters = projectDirectoryListParams({
    listQ: text(formData, "listQ"),
    listStatus: text(formData, "listStatus"),
    listPage: text(formData, "listPage"),
  }, true);
  if (projectId === undefined) return directoryHref("/settings/projects", filters);
  const path = `/settings/projects/${projectId}`;
  return directoryHref(nodeId === undefined ? path : `${path}/nodes/${nodeId}`, projectDirectoryDetailParams(filters));
}

export async function saveProjectAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await actionUser();
  const id = numberValue(formData, "id");
  const status = text(formData, "status") as "ACTIVE" | "PAUSED" | "ARCHIVED";
  let projectId: number;
  try {
    projectId = saveProject(user, {
      id: id ?? undefined,
      name: text(formData, "name"),
      code: text(formData, "code"),
      description: text(formData, "description"),
      pmUserIds: idList(formData, "pmUserIds"),
      softwareManagerIds: formData.has("softwareManagerIds") ? idList(formData, "softwareManagerIds") : undefined,
      status: status || "ACTIVE",
      stage: formData.has("stage") ? text(formData, "stage") : undefined,
      sortOrder: undefined,
    });
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  successRedirect(projectSettingsHref(formData, projectId), id ? "项目配置已更新。" : "项目已创建，可继续添加测试节点。");
}

export async function addProjectNodeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await actionUser();
  const projectId = numberValue(formData, "projectId");
  if (!projectId) return { error: "项目参数无效。" };
  try {
    addProjectNode(
      user,
      projectId,
      text(formData, "name"),
      text(formData, "description"),
      {
        bindingOwnerId: numberValue(formData, "bindingOwnerId"),
        bindingApproverId: numberValue(formData, "bindingApproverId"),
        requiredBindingCount: numberValue(formData, "requiredBindingCount") ?? 1,
      },
    );
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  successRedirect(projectSettingsHref(formData, projectId), "项目测试节点已添加。");
}

export async function addProjectNodeApproverAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await actionUser();
  const nodeId = numberValue(formData, "nodeId");
  const userId = numberValue(formData, "userId");
  if (!nodeId || !userId) return { error: "请选择审批人。" };
  let projectId: number;
  try {
    projectId = addProjectNodeApprover(user, nodeId, userId);
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  successRedirect(projectSettingsHref(formData, projectId, nodeId), "节点审批人范围已更新。");
}

export async function removeProjectNodeApproverAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await actionUser();
  const assignmentId = numberValue(formData, "assignmentId");
  if (!assignmentId) return { error: "审批人参数无效。" };
  let scope: ReturnType<typeof removeProjectNodeApprover>;
  try {
    scope = removeProjectNodeApprover(user, assignmentId);
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  successRedirect(projectSettingsHref(formData, scope.projectId, scope.nodeId), "节点审批人已移除。");
}

export async function updateProjectNodeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await actionUser();
  const nodeId = numberValue(formData, "nodeId");
  if (!nodeId) return { error: "项目节点参数无效。" };
  let projectId: number;
  try {
    projectId = updateProjectNode(
      user,
      nodeId,
      text(formData, "name"),
      text(formData, "description"),
      {
        bindingOwnerId: numberValue(formData, "bindingOwnerId"),
        bindingApproverId: numberValue(formData, "bindingApproverId"),
        requiredBindingCount: numberValue(formData, "requiredBindingCount") ?? 1,
      },
    );
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  successRedirect(projectSettingsHref(formData, projectId, nodeId), "项目节点绑定配置已更新。");
}

export async function deleteProjectNodeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await actionUser();
  const nodeId = numberValue(formData, "nodeId");
  if (!nodeId) return { error: "项目节点参数无效。" };
  let projectId: number;
  try {
    projectId = deleteProjectNode(user, nodeId);
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  successRedirect(projectSettingsHref(formData, projectId), "项目测试节点已删除。");
}

export async function deleteProjectAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await actionUser();
  const id = numberValue(formData, "id");
  if (!id) return { error: "项目参数无效。" };
  try {
    deleteProject(user, id);
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  successRedirect(projectSettingsHref(formData), "项目已删除。");
}
