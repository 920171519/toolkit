"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import type { ActionState } from "@/lib/action-state";
import {
  checkbox,
  failure,
  idList,
  numberValue,
  text,
  successRedirect,
} from "@/lib/action-helpers";
import {
  addAreaLeader,
  addProjectNode,
  addProjectNodeApprover,
  updateProjectNode,
  assignAreaProjectLead,
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

async function actionUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

function refreshAll() {
  revalidatePath("/", "layout");
}

export async function saveAreaAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await actionUser();
  const id = numberValue(formData, "id");
  try {
    saveArea(user, {
      id: id ?? undefined,
      name: text(formData, "name"),
      description: text(formData, "description"),
    });
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  successRedirect("/settings/areas", id ? "责任田配置已更新。" : "责任田已创建。");
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
  successRedirect("/settings/areas", "责任田主管已设置。");
}

export async function removeAreaLeaderAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await actionUser();
  const leaderId = numberValue(formData, "leaderId");
  if (!leaderId) return { error: "责任田主管参数无效。" };
  try {
    removeAreaLeader(user, leaderId);
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  successRedirect("/settings/areas", "责任田主管已移除。");
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
  successRedirect("/settings/areas", "项目成员已添加。");
}

export async function removeAreaProjectMemberAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await actionUser();
  const memberId = numberValue(formData, "memberId");
  if (!memberId) return { error: "项目成员参数无效。" };
  try {
    removeAreaProjectMember(user, memberId);
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  successRedirect("/settings/areas", "项目成员已移除。");
}

export async function assignAreaProjectLeadAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await actionUser();
  const areaId = numberValue(formData, "areaId");
  const projectId = numberValue(formData, "projectId");
  const userId = numberValue(formData, "userId");
  if (!areaId || !projectId || !userId) return { error: "请选择项目负责人和人员。" };
  try {
    assignAreaProjectLead(user, areaId, projectId, userId);
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  successRedirect("/settings/areas", "项目负责人已设置。");
}

export async function removeAreaProjectLeadAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await actionUser();
  const assignmentId = numberValue(formData, "assignmentId");
  if (!assignmentId) return { error: "项目负责人参数无效。" };
  try {
    removeAreaProjectLead(user, assignmentId);
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  successRedirect("/settings/areas", "项目负责人已移除。");
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
  successRedirect("/settings/areas", "责任田已删除。");
}

export async function saveProjectAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await actionUser();
  const id = numberValue(formData, "id");
  const status = text(formData, "status") as "ACTIVE" | "PAUSED" | "ARCHIVED";
  try {
    saveProject(user, {
      id: id ?? undefined,
      name: text(formData, "name"),
      code: text(formData, "code"),
      description: text(formData, "description"),
      pmUserIds: formData.getAll("pmUserIds").map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0),
      softwareManagerIds: formData.getAll("softwareManagerIds").map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0),
      status: status || "ACTIVE",
      sortOrder: undefined,
    });
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  successRedirect("/settings/projects", id ? "项目配置已更新。" : "项目已创建，可继续添加测试节点。");
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
  successRedirect("/settings/projects", "项目测试节点已添加。");
}

export async function addProjectNodeApproverAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await actionUser();
  const nodeId = numberValue(formData, "nodeId");
  const userId = numberValue(formData, "userId");
  if (!nodeId || !userId) return { error: "请选择审批人。" };
  try {
    addProjectNodeApprover(user, nodeId, userId);
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  successRedirect("/settings/projects", "节点审批人范围已更新。");
}

export async function removeProjectNodeApproverAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await actionUser();
  const assignmentId = numberValue(formData, "assignmentId");
  if (!assignmentId) return { error: "审批人参数无效。" };
  try {
    removeProjectNodeApprover(user, assignmentId);
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  successRedirect("/settings/projects", "节点审批人已移除。");
}

export async function updateProjectNodeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await actionUser();
  const nodeId = numberValue(formData, "nodeId");
  if (!nodeId) return { error: "项目节点参数无效。" };
  try {
    updateProjectNode(
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
  successRedirect("/settings/projects", "项目节点绑定配置已更新。");
}

export async function deleteProjectNodeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await actionUser();
  const nodeId = numberValue(formData, "nodeId");
  if (!nodeId) return { error: "项目节点参数无效。" };
  try {
    deleteProjectNode(user, nodeId);
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  successRedirect("/settings/projects", "项目测试节点已删除。");
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
  successRedirect("/settings/projects", "项目已删除。");
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
    `/settings/packages/${packageId}`,
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
  successRedirect(`/settings/packages/${packageId}`, "历史版本已导入，可在软件包详情中查看。");
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
  try {
    savePackageUsages(user, packageId, idList(formData, "nodeIds"));
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  successRedirect(`/settings/packages/${packageId}`, "项目使用范围已更新。");
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
  successRedirect("/settings/users", "人员角色已更新。");
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
  successRedirect("/settings/users", active ? "账号已启用。" : "账号已停用。");
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
  successRedirect("/settings/users", "人员资料已更新。");
}
