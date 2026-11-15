"use server";

import { redirect } from "next/navigation";
import { getCurrentUser, createSession, destroySession, verifyLogin } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { one, run } from "@/lib/db";
import { DEPARTMENT_NAME } from "@/lib/constants";
import type { ActionState } from "@/lib/action-state";
import { text } from "@/lib/action-helpers";
import { failure } from "@/lib/action-helpers";

export async function registerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const name = text(formData, "name");
  const employeeId = text(formData, "employeeId").toUpperCase();
  const password = text(formData, "password");
  const confirmPassword = text(formData, "confirmPassword");
  const fieldErrors: Record<string, string> = {};
  if (name.length < 2 || name.length > 30) fieldErrors.name = "请输入 2-30 个字符的姓名。";
  if (!/^[A-Za-z0-9_-]{3,32}$/.test(employeeId)) {
    fieldErrors.employeeId = "工号需为 3-32 位字母、数字、下划线或中划线。";
  }
  if (password.length < 8) fieldErrors.password = "密码至少需要 8 个字符。";
  if (password.length > 72) fieldErrors.password = "密码不能超过 72 个字符。";
  if (password !== confirmPassword) fieldErrors.confirmPassword = "两次输入的密码不一致。";
  if (Object.keys(fieldErrors).length > 0) return { error: "请检查注册信息。", fieldErrors };

  try {
    const existing = one<{ id: number }>("SELECT id FROM users WHERE employee_id = ? COLLATE NOCASE", employeeId);
    if (existing) return { error: "该工号已注册，请直接登录。", fieldErrors: { employeeId: "该工号已被使用。" } };
    const result = run(
      `INSERT INTO users (name, employee_id, password_hash, role, department, title, is_active, created_at)
       VALUES (?, ?, ?, 'MEMBER', ?, '', 1, ?)`,
      name,
      employeeId,
      hashPassword(password),
      DEPARTMENT_NAME,
      new Date().toISOString(),
    );
    const userId = Number(result.lastInsertRowid);
    await createSession(userId);
  } catch (error) {
    return failure(error);
  }
  redirect("/dashboard?flash=" + encodeURIComponent("注册成功，欢迎加入工程协同台。"));
}

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const employeeId = text(formData, "employeeId");
  const password = text(formData, "password");
  const next = text(formData, "next");
  if (!employeeId || !password) return { error: "请输入工号和密码。" };
  const user = await verifyLogin(employeeId, password);
  if (!user) return { error: "工号或密码不正确，或账号已停用。" };
  await createSession(user.id);
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  redirect(safeNext);
}

export async function logoutAction(): Promise<void> {
  const user = await getCurrentUser();
  if (user) {
    await destroySession();
  }
  redirect("/");
}
