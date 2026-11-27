import "server-only";

import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { normalizeEmployeeId } from "./account-identity";
import { createAuditLogWriter } from "./audit-log";
import { DEPARTMENT_NAME, type Role } from "./constants";
import { db, one, run, transaction } from "./db";
import { hashPassword, verifyPassword } from "./password";
import type { SessionUser } from "./types";
import { safeWorkspacePath } from "./return-to";
import {
  hashSessionToken,
  persistSession,
  readSessionCredentials,
  readSessionUser,
  replacePasswordForSession,
  revokeSession,
  revokeUserSessions,
} from "./session-store";

export const SESSION_COOKIE = "toolkit_session";
const audit = createAuditLogWriter(db);

export async function loginWithPassword(employeeId: string, password: string): Promise<boolean> {
  const user = one<{ id: number; password_hash: string }>(
    "SELECT id, password_hash FROM users WHERE employee_id = ? COLLATE NOCASE AND is_active = 1",
    normalizeEmployeeId(employeeId),
  );
  if (!user || !verifyPassword(password, user.password_hash)) return false;
  const writeCookie = await prepareSessionCookie();
  const session = transaction(() => persistSession(user.id, user.password_hash));
  if (!session) return false;
  writeCookie(session);
  return true;
}

async function prepareSessionCookie() {
  const cookieStore = await cookies();
  const requestHeaders = await headers();
  const forwardedProto = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  const secureCookie = process.env.SESSION_COOKIE_SECURE
    ? process.env.SESSION_COOKIE_SECURE === "true"
    : forwardedProto === "https";
  return ({ token, expiresAt }: { token: string; expiresAt: Date }) => cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie,
    path: "/",
    expires: expiresAt,
  });
}

export async function registerMember({ name, employeeId, password }: { name: string; employeeId: string; password: string }): Promise<boolean> {
  const writeCookie = await prepareSessionCookie();
  const passwordHash = hashPassword(password);
  const session = transaction(() => {
    const inserted = run(
      `INSERT INTO users (name, employee_id, password_hash, role, department, title, is_active, created_at)
       VALUES (?, ?, ?, 'MEMBER', ?, '', 1, ?)
       ON CONFLICT(employee_id) DO NOTHING`,
      name,
      employeeId,
      passwordHash,
      DEPARTMENT_NAME,
      new Date().toISOString(),
    );
    if (!inserted.changes) return null;
    const created = persistSession(Number(inserted.lastInsertRowid), passwordHash);
    if (!created) throw new Error("Session issuance did not match the newly registered member.");
    return created;
  });
  if (!session) return false;
  writeCookie(session);
  return true;
}

export async function changeCurrentPassword(userId: number, currentPassword: string, newPassword: string) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return "expired";
  const tokenHash = hashSessionToken(token);
  const credentials = readSessionCredentials(userId, tokenHash);
  if (!credentials) return "expired";
  if (!verifyPassword(currentPassword, credentials.password_hash)) return "incorrect";
  const replacement = hashPassword(newPassword);

  const changed = transaction(() => {
    const now = new Date().toISOString();
    if (!replacePasswordForSession(userId, tokenHash, credentials.password_hash, replacement, now)) return false;
    revokeUserSessions(userId);
    audit(userId, "CHANGE_PASSWORD", "USER", userId, "用户修改自己的登录密码", now);
    return true;
  });
  if (!changed) return "expired";
  cookieStore.delete(SESSION_COOKIE);
  return "changed";
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    revokeSession(token);
  }
  cookieStore.delete(SESSION_COOKIE);
}

export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return readSessionUser(token) ?? null;
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    const next = safeWorkspacePath((await headers()).get("x-toolkit-workspace-path"));
    redirect(next && next !== "/dashboard" ? `/login?next=${encodeURIComponent(next)}` : "/login");
  }
  return user;
}

export async function requireRole(roles: Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) {
    redirect("/dashboard?tone=error&flash=" + encodeURIComponent("当前角色无权访问该页面。请联系系统管理员核对权限。"));
  }
  return user;
}
