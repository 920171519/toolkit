"use server";

import type { ActionState } from "@/lib/action-state";
import { actionUser, failure, numberValue, refreshAll, successRedirect, text } from "@/lib/action-helpers";
import {
  addAreaLeader,
  assignAreaProjectLead,
  assignAreaProjectMember,
  deleteArea,
  removeAreaLeader,
  removeAreaProjectLead,
  removeAreaProjectMember,
  saveArea,
} from "@/lib/area-settings";
import { areaDirectoryDetailParams, areaDirectoryListParams, directoryFilters, directoryHref } from "@/lib/settings-directory";

function areaFormFilters(formData: FormData) {
  return Object.fromEntries([...formData.entries()].flatMap(([key, value]) => typeof value === "string" ? [[key, value]] : []));
}

function areaDetailHref(formData: FormData, areaId: number, isNew = false) {
  const params = areaFormFilters(formData);
  const list = areaDirectoryDetailParams(isNew ? params : areaDirectoryListParams(params));
  const { q, page, pageSize } = directoryFilters("areas", params);
  return directoryHref(`/settings/areas/${areaId}`, { ...list, ...(!isNew && { q, page, pageSize }) });
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
