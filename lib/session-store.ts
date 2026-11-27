import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { one, run } from "./db";
import type { SessionUser } from "./types";

const SESSION_DAYS = 7;
const currentSessionTokenSql = "s.token_hash = ? AND s.expires_at > ?";

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function persistSession(userId: number, verifiedPasswordHash: string) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  // Issue a session only while the password verified at login is still current.
  const inserted = run(
    `INSERT INTO sessions (token_hash, user_id, expires_at, created_at)
     SELECT ?, id, ?, ? FROM users WHERE id = ? AND is_active = 1 AND password_hash = ?`,
    hashSessionToken(token),
    expiresAt.toISOString(),
    now.toISOString(),
    userId,
    verifiedPasswordHash,
  );
  if (!inserted.changes) return null;
  run("DELETE FROM sessions WHERE expires_at < ?", now.toISOString());
  return { token, expiresAt };
}

export function readSessionUser(token: string) {
  return one<SessionUser>(
    `SELECT u.id, u.name, u.employee_id AS employeeId, u.role, u.department, u.title
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE ${currentSessionTokenSql} AND u.is_active = 1`,
    hashSessionToken(token),
    new Date().toISOString(),
  );
}

export function readSessionCredentials(userId: number, tokenHash: string) {
  return one<{ password_hash: string }>(
    `SELECT u.password_hash
     FROM users u JOIN sessions s ON s.user_id = u.id
     WHERE u.id = ? AND u.is_active = 1 AND ${currentSessionTokenSql}`,
    userId,
    tokenHash,
    new Date().toISOString(),
  );
}

export function replacePasswordForSession(
  userId: number,
  tokenHash: string,
  verifiedPasswordHash: string,
  replacement: string,
  now: string,
) {
  const result = run(
    `UPDATE users SET password_hash = ?
     WHERE id = ? AND is_active = 1 AND password_hash = ?
       AND EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = users.id AND ${currentSessionTokenSql})`,
    replacement,
    userId,
    verifiedPasswordHash,
    tokenHash,
    now,
  );
  return Boolean(result.changes);
}

export function revokeSession(token: string) {
  run("DELETE FROM sessions WHERE token_hash = ?", hashSessionToken(token));
}

export function revokeUserSessions(userId: number) {
  run("DELETE FROM sessions WHERE user_id = ?", userId);
}
