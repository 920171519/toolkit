"use server";

import type { ActionState } from "@/lib/action-state";
import {
  actionUser,
  checkbox,
  failure,
  idList,
  numberValue,
  refreshAll,
  text,
  successRedirect,
} from "@/lib/action-helpers";
import {
  addAreaLeader,
  addProjectNode,
  addProjectNodeApprover,
  updateProjectNode,
  assignAreaProjectLead,
  correctLegacyVersion,
  deleteArea,
  deleteProject,
  deleteProjectNode,
  removeAreaLeader,
  removeAreaProjectLead,
  removeAreaProjectMember,
  removeProjectNodeApprover,
  saveArea,
  assignAreaProjectMember,
  savePackage,
  importLegacyVersion,
  savePackageUsages,
  saveProject,
  saveUserProfile,
  setUserActive,
  updatePackageResponsibility,
  updateUserRole,
} from "@/lib/settings";
import { ROLES, type Role } from "@/lib/constants";
import { areaDirectoryDetailParams, areaDirectoryListParams, directoryActionHref, directoryFilters, directoryHref, projectDirectoryDetailParams, projectDirectoryListParams } from "@/lib/settings-directory";

function areaFormFilters(formData: FormData) {
  return Object.fromEntries([...formData.entries()].flatMap(([key, value]) => typeof value === "string" ? [[key, value]] : []));
}

function areaDetailHref(formData: FormData, areaId: number, isNew = false) {
  const params = areaFormFilters(formData);
  const list = areaDirectoryDetailParams(isNew ? params : areaDirectoryListParams(params));
  const { q, page, pageSize } = directoryFilters("areas", params);
  return directoryHref(`/settings/areas/${areaId}`, { ...list, ...(!isNew && { q, page, pageSize }) });
}

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

export async function saveAreaAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await actionUser();
  const id = numberValue(formData, "id");
  let areaId: number;
  try {
    areaId = saveArea(user, {
      id: id ?? undefined,
      name: text(formData, "name"),
      description: text(formData, "description"),
    });
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  successRedirect(areaDetailHref(formData, areaId, !id), id ? "责任田配置已更新。" : "责任田已创建，可继续设置主管。");
}

export async function addAreaLeaderAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await actionUser();
  const areaId = numberValue(formData, "areaId");
  const userId = numberValue(formData, "userId");
  if (!areaId || !userId) return { error: "请选择责任田主管。" };
  try {
    addAreaLeader(user, areaId, userId);
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  successRedirect(areaDetailHref(formData, areaId), "责任田主管已设置。");
}

export async function removeAreaLeaderAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await actionUser();
  const leaderId = numberValue(formData, "leaderId");
  if (!leaderId) return { error: "责任田主管参数无效。" };
  let areaId: number;
  try {
    areaId = removeAreaLeader(user, leaderId);
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  successRedirect(areaDetailHref(formData, areaId), "责任田主管已移除。");
}

export async function assignAreaProjectMemberAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await actionUser();
  const areaId = numberValue(formData, "areaId");
  const projectId = numberValue(formData, "projectId");
  const userId = numberValue(formData, "userId");
  if (!areaId || !projectId || !userId) return { error: "请选择项目和项目成员。" };
  try {
    assignAreaProjectMember(user, areaId, projectId, userId);
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  successRedirect(areaDetailHref(formData, areaId), "项目成员已添加。");
}

export async function removeAreaProjectMemberAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await actionUser();
  const memberId = numberValue(formData, "memberId");
  if (!memberId) return { error: "项目成员参数无效。" };
  let areaId: number;
  try {
    areaId = removeAreaProjectMember(user, memberId);
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  successRedirect(areaDetailHref(formData, areaId), "项目成员已移除。");
}

export async function assignAreaProjectLeadAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await actionUser();
  const areaId = numberValue(formData, "areaId");
  const projectId = numberValue(formData, "projectId");
  const userId = numberValue(formData, "userId");
  const assignmentId = numberValue(formData, "assignmentId");
  if (!areaId || !projectId || !userId) return { error: "请选择项目负责人和人员。" };
  try {
    assignAreaProjectLead(user, areaId, projectId, userId, assignmentId ?? undefined, numberValue(formData, "oldUserId") ?? undefined);
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  successRedirect(areaDetailHref(formData, areaId), assignmentId ? "项目负责人已更换。" : "项目负责人已设置。");
}

export async function removeAreaProjectLeadAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await actionUser();
  const assignmentId = numberValue(formData, "assignmentId");
  if (!assignmentId) return { error: "项目负责人参数无效。" };
  let areaId: number;
  try {
    areaId = removeAreaProjectLead(user, assignmentId);
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  successRedirect(areaDetailHref(formData, areaId), "项目负责人已移除。");
}

export async function deleteAreaAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await actionUser();
  const id = numberValue(formData, "id");
  if (!id) return { error: "责任田参数无效。" };
  try {
    deleteArea(user, id);
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  successRedirect(directoryHref("/settings/areas", areaDirectoryListParams(areaFormFilters(formData))), "责任田已删除。");
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

export async function savePackageAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await actionUser();
  const id = numberValue(formData, "id");
  let packageId: number;
  try {
    packageId = savePackage(user, {
      id: id ?? undefined,
      name: text(formData, "name"),
      code: text(formData, "code"),
      description: text(formData, "description"),
      areaId: numberValue(formData, "areaId"),
      ownerId: numberValue(formData, "ownerId"),
      isActive: checkbox(formData, "isActive"),
      trialOverdueDays: numberValue(formData, "trialOverdueDays") ?? 7,
    });
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  successRedirect(
    directoryActionHref("packages", formData, packageId),
    id ? "软件包信息已更新。" : "软件包已创建，请继续配置使用范围。",
  );
}


export async function importLegacyVersionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await actionUser();
  const packageId = numberValue(formData, "packageId");
  if (!packageId) return { error: "请选择软件包。" };
  const status = text(formData, "status") === "TRIAL" ? "TRIAL" : "FORMAL";
  try {
    importLegacyVersion(user, {
      packageId,
      version: text(formData, "version"),
      changeSummary: text(formData, "changeSummary"),
      archiveUrl: text(formData, "archiveUrl"),
      buildUrl: text(formData, "buildUrl"),
      status,
      trialFormNo: text(formData, "trialFormNo"),
      trialReleasedAt: text(formData, "trialReleasedAt"),
      formFlowNo: text(formData, "formFlowNo"),
      formalReleasedAt: text(formData, "formalReleasedAt"),
    });
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  successRedirect(directoryActionHref("packages", formData, packageId), "历史版本已导入，可在软件包详情中查看。");
}

export async function correctLegacyVersionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await actionUser();
  const packageId = numberValue(formData, "packageId");
  const versionId = numberValue(formData, "versionId");
  if (!packageId || !versionId) return { error: "历史版本参数无效。" };
  try {
    correctLegacyVersion(user, packageId, versionId, {
      expectedUpdatedAt: text(formData, "expectedUpdatedAt"),
      reason: text(formData, "reason"),
      changeSummary: text(formData, "changeSummary"),
      archiveUrl: text(formData, "archiveUrl"),
      buildUrl: text(formData, "buildUrl"),
      trialFormNo: text(formData, "trialFormNo"),
      trialReleasedAt: text(formData, "trialReleasedAt"),
      formFlowNo: text(formData, "formFlowNo"),
      formalReleasedAt: text(formData, "formalReleasedAt"),
    });
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  successRedirect(directoryActionHref("packages", formData, packageId), "历史版本已更正。");
}

export async function updatePackageResponsibilityAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await actionUser();
  const packageId = numberValue(formData, "packageId");
  if (!packageId) return { error: "软件包参数无效。" };
  try {
    updatePackageResponsibility(user, packageId, {
      ownerId: numberValue(formData, "ownerId"),
      description: text(formData, "description"),
      isActive: checkbox(formData, "isActive"),
    });
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  return { success: "软件包责任信息已更新。" };
}

export async function savePackageUsagesAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await actionUser();
  const packageId = numberValue(formData, "packageId");
  if (!packageId) return { error: "软件包参数无效。" };
  let backfilled: number;
  try {
    backfilled = savePackageUsages(user, packageId, idList(formData, "nodeIds"));
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  successRedirect(directoryActionHref("packages", formData, packageId), backfilled > 0 ? `项目使用范围已更新，已补派 ${backfilled} 条转测申请。` : "项目使用范围已更新。");
}

export async function updateUserRoleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await actionUser();
  const userId = numberValue(formData, "userId");
  const role = text(formData, "role") as Role;
  if (!userId || !ROLES.includes(role)) return { error: "人员角色参数无效。" };
  try {
    updateUserRole(user, userId, role);
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  successRedirect(directoryActionHref("users", formData, userId), "人员角色已更新。");
}

export async function setUserActiveAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await actionUser();
  const userId = numberValue(formData, "userId");
  const active = text(formData, "active") === "1";
  if (!userId) return { error: "人员参数无效。" };
  try {
    setUserActive(user, userId, active);
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  successRedirect(directoryActionHref("users", formData, userId), active ? "账号已启用。" : "账号已停用。");
}

export async function saveUserProfileAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await actionUser();
  const userId = numberValue(formData, "userId");
  if (!userId) return { error: "人员参数无效。" };
  try {
    saveUserProfile(user, userId, text(formData, "name"), text(formData, "title"));
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  successRedirect(directoryActionHref("users", formData, userId), "人员资料已更新。");
}
