"use server";

import type { ActionState } from "@/lib/action-state";
import { actionUser, failure, numberValue, refreshAll, successRedirect, text } from "@/lib/action-helpers";
import { ROLES, type Role } from "@/lib/domain-values";
import { directoryActionHref } from "@/lib/settings-directory";
import { saveUserProfile, setUserActive, updateUserRole } from "@/lib/user-settings";

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
