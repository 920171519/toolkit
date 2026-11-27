"use server";

import { redirect } from "next/navigation";
import { changeCurrentPassword, destroySession, getCurrentUser, loginWithPassword, registerMember } from "@/lib/auth";
import { isValidAccountDisplayName, isValidEmployeeId, normalizeEmployeeId } from "@/lib/account-identity";
import type { ActionState } from "@/lib/action-state";
import { failure, raw, text } from "@/lib/action-helpers";
import { safeWorkspacePath } from "@/lib/return-to";

function passwordLengthError(password: string): string | undefined {
  if (password.length < 8) return "密码至少需要 8 个字符。";
  if (password.length > 72) return "密码不能超过 72 个字符。";
}

export async function registerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const name = text(formData, "name");
  const employeeId = normalizeEmployeeId(raw(formData, "employeeId"));
  const password = text(formData, "password");
  const confirmPassword = text(formData, "confirmPassword");
  const fieldErrors: Record<string, string> = {};
  if (!isValidAccountDisplayName(name)) fieldErrors.name = "请输入 2-30 个字符的姓名。";
  if (!isValidEmployeeId(employeeId)) {
    fieldErrors.employeeId = "工号需为 3-32 位字母、数字、下划线或中划线。";
  }
  const passwordError = passwordLengthError(password);
  if (passwordError) fieldErrors.password = passwordError;
  if (password !== confirmPassword) fieldErrors.confirmPassword = "两次输入的密码不一致。";
  if (Object.keys(fieldErrors).length > 0) return { error: "请检查注册信息。", fieldErrors };

  try {
    if (!await registerMember({ name, employeeId, password })) {
      return { error: "该工号已注册，请直接登录。", fieldErrors: { employeeId: "该工号已被使用。" } };
    }
  } catch (error) {
    return failure(error);
  }
  redirect("/dashboard?flash=" + encodeURIComponent("账号已创建"));
}

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const employeeId = text(formData, "employeeId");
  const password = text(formData, "password");
  const next = text(formData, "next");
  if (!employeeId || !password) return { error: "请输入工号和密码。" };
  try {
    if (!await loginWithPassword(employeeId, password)) return { error: "工号或密码不正确，或账号已停用。" };
  } catch (error) {
    return failure(error);
  }
  redirect(safeWorkspacePath(next) ?? "/dashboard");
}

export async function changePasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const loginPath = "/login?next=%2Faccount%2Fpassword";
  const user = await getCurrentUser();
  if (!user) redirect(loginPath);

  const currentPassword = text(formData, "currentPassword");
  const newPassword = text(formData, "newPassword");
  const confirmation = text(formData, "confirmPassword");
  const fieldErrors: Record<string, string> = {};
  if (!currentPassword) fieldErrors.currentPassword = "请输入当前密码。";
  const lengthError = passwordLengthError(newPassword);
  if (lengthError) fieldErrors.newPassword = lengthError;
  else if (newPassword === currentPassword) fieldErrors.newPassword = "新密码不能与当前密码相同。";
  if (newPassword !== confirmation) fieldErrors.confirmPassword = "两次输入的新密码不一致。";
  if (Object.keys(fieldErrors).length > 0) return { error: "请检查密码信息。", fieldErrors };

  let result: Awaited<ReturnType<typeof changeCurrentPassword>>;
  try {
    result = await changeCurrentPassword(user.id, currentPassword, newPassword);
  } catch (error) {
    return failure(error);
  }
  if (result === "incorrect") {
    return { error: "当前密码不正确。", fieldErrors: { currentPassword: "当前密码不正确。" } };
  }
  if (result === "expired") redirect(loginPath);
  redirect("/login?passwordChanged=1");
}

export async function logoutAction(): Promise<void> {
  const user = await getCurrentUser();
  if (user) {
    await destroySession();
  }
  redirect("/");
}
