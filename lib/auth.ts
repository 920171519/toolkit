import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Role } from "./constants";
import { one, run, transaction } from "./db";
import { hashPassword, verifyPassword } from "./password";
import type { SessionUser } from "./types";
import { safeWorkspacePath } from "./return-to";

export const SESSION_COOKIE = "toolkit_session";
const SESSION_DAYS = 7;

type UserRow = {
  id: number;
  name: string;
  employee_id: string;
  password_hash: string;
  role: Role;
  department: string;
  title: string;
  is_active: number;
};

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function loginWithPassword(employeeId: string, password: string): Promise<boolean> {
  const user = one<{ id: number; password_hash: string }>(
    "SELECT id, password_hash FROM users WHERE employee_id = ? COLLATE NOCASE AND is_active = 1",
    employeeId.trim().toUpperCase(),
  );
  if (!user || !verifyPassword(password, user.password_hash)) return false;
  return createSession(user.id, user.password_hash);
}

export async function createSession(userId: number, verifiedPasswordHash?: string): Promise<boolean> {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  // Issue a session only while the password verified at login is still current.
  const inserted = run(
    `INSERT INTO sessions (token_hash, user_id, expires_at, created_at)
     SELECT ?, id, ?, ? FROM users WHERE id = ? AND is_active = 1 AND password_hash = COALESCE(?, password_hash)`,
    hashToken(token),
    expiresAt.toISOString(),
    now.toISOString(),
    userId,
    verifiedPasswordHash ?? null,
  );
  if (!inserted.changes) return false;
  run("DELETE FROM sessions WHERE expires_at < ?", now.toISOString());
  const cookieStore = await cookies();
  const requestHeaders = await headers();
  const forwardedProto = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  const secureCookie = process.env.SESSION_COOKIE_SECURE
    ? process.env.SESSION_COOKIE_SECURE === "true"
    : forwardedProto === "https";
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie,
    path: "/",
    expires: expiresAt,
  });
  return true;
}

export async function changeCurrentPassword(userId: number, currentPassword: string, newPassword: string) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return "expired";
  const tokenHash = hashToken(token);
  const credentials = one<{ password_hash: string }>(
    `SELECT u.password_hash
     FROM users u JOIN sessions s ON s.user_id = u.id
     WHERE u.id = ? AND u.is_active = 1 AND s.token_hash = ? AND s.expires_at > ?`,
    userId,
    tokenHash,
    new Date().toISOString(),
  );
  if (!credentials) return "expired";
  if (!verifyPassword(currentPassword, credentials.password_hash)) return "incorrect";
  const replacement = hashPassword(newPassword);

  const changed = transaction(() => {
    const now = new Date().toISOString();
    const result = run(
      `UPDATE users SET password_hash = ?
       WHERE id = ? AND is_active = 1 AND password_hash = ?
         AND EXISTS (SELECT 1 FROM sessions WHERE user_id = users.id AND token_hash = ? AND expires_at > ?)`,
      replacement,
      userId,
      credentials.password_hash,
      tokenHash,
      now,
    );
    if (!result.changes) return false;
    run("DELETE FROM sessions WHERE user_id = ?", userId);
    run(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, detail, created_at)
       VALUES (?, 'CHANGE_PASSWORD', 'USER', ?, '用户修改自己的登录密码', ?)`,
      userId,
      userId,
      now,
    );
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
    run("DELETE FROM sessions WHERE token_hash = ?", hashToken(token));
  }
  cookieStore.delete(SESSION_COOKIE);
}

type SessionRow = UserRow & { expires_at: string };

export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = one<SessionRow>(
    `SELECT u.*, s.expires_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ? AND u.is_active = 1`,
    hashToken(token),
    new Date().toISOString(),
  );
  if (!row) return null;
  return toSessionUser(row);
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
    redirect("/dashboard?flash=" + encodeURIComponent("当前角色无权访问该页面。"));
  }
  return user;
}

function toSessionUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    name: row.name,
    employeeId: row.employee_id,
    role: row.role,
    department: row.department,
    title: row.title,
  };
}
