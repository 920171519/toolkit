import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Role } from "./constants";
import { one, run } from "./db";
import { verifyPassword } from "./password";
import type { SessionUser } from "./types";

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

export async function verifyLogin(employeeId: string, password: string): Promise<SessionUser | null> {
  const normalizedId = employeeId.trim().toUpperCase();
  const user = one<UserRow>(
    "SELECT * FROM users WHERE employee_id = ? COLLATE NOCASE AND is_active = 1",
    normalizedId,
  );
  if (!user || !verifyPassword(password, user.password_hash)) return null;
  return toSessionUser(user);
}

export async function createSession(userId: number): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  run(
    "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
    hashToken(token),
    userId,
    expiresAt.toISOString(),
    new Date().toISOString(),
  );
  run("DELETE FROM sessions WHERE expires_at < ?", new Date().toISOString());
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
  if (!user) redirect("/login");
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
