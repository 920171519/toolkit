import "server-only";

import { isValidAccountDisplayName } from "./account-identity";
import { createAuditLogWriter } from "./audit-log";
import { ROLES, type Role } from "./constants";
import { db, one, run, transaction } from "./db";
import { assert } from "./domain-error";
import { isAdmin } from "./permissions";
import { revokeUserSessions } from "./session-store";
import { getSettingsPackageReferences } from "./settings-queries";
import type { SessionUser } from "./types";

const audit = createAuditLogWriter(db);

function assertAnotherActiveAdminRemains() {
  const adminCount = one<{ count: number }>(
    "SELECT COUNT(*) AS count FROM users WHERE role = 'ADMIN' AND is_active = 1",
  );
  assert(Number(adminCount?.count ?? 0) > 1, "系统至少需要保留一名启用状态的管理员。");
}

export function updateUserRole(actor: SessionUser, userId: number, role: Role) {
  assert(isAdmin(actor), "只有系统管理员可以调整人员角色。", "FORBIDDEN");
  assert(ROLES.includes(role), "角色无效。");
  transaction(() => {
    const target = one<{ id: number; name: string; role: Role }>(
      "SELECT id, name, role FROM users WHERE id = ?",
      userId,
    );
    assert(target, "人员不存在。", "NOT_FOUND");
    assert(target.id !== actor.id, "不能修改自己的角色，请联系其他管理员操作。");
    if (target.role === "ADMIN" && role !== "ADMIN") assertAnotherActiveAdminRemains();
    run("UPDATE users SET role = ? WHERE id = ?", role, userId);
    audit(actor.id, "UPDATE_USER_ROLE", "USER", userId, `将 ${target.name} 的角色调整为 ${role}`);
  });
}

export function setUserActive(actor: SessionUser, userId: number, active: boolean) {
  assert(isAdmin(actor), "只有系统管理员可以启用或停用人员。", "FORBIDDEN");
  transaction(() => {
    const target = one<{ id: number; name: string; role: Role }>(
      "SELECT id, name, role FROM users WHERE id = ?",
      userId,
    );
    assert(target, "人员不存在。", "NOT_FOUND");
    assert(target.id !== actor.id, "不能停用自己的账号。");
    if (!active && target.role === "ADMIN") assertAnotherActiveAdminRemains();
    if (!active) {
      assert(getSettingsPackageReferences({ enabledOwnerId: userId }).length === 0, "该人员仍负责启用中的软件包，请先转移责任人。");
    }
    run("UPDATE users SET is_active = ? WHERE id = ?", active ? 1 : 0, userId);
    if (!active) revokeUserSessions(userId);
    audit(
      actor.id,
      active ? "ENABLE_USER" : "DISABLE_USER",
      "USER",
      userId,
      `${active ? "启用" : "停用"}账号：${target.name}`,
    );
  });
}

export function saveUserProfile(actor: SessionUser, userId: number, name: string, title: string) {
  assert(isAdmin(actor), "只有系统管理员可以编辑人员资料。", "FORBIDDEN");
  const displayName = name.trim();
  assert(isValidAccountDisplayName(displayName), "姓名需为 2-30 个字符。");
  const target = one<{ id: number; name: string }>("SELECT id, name FROM users WHERE id = ?", userId);
  assert(target, "人员不存在。", "NOT_FOUND");
  transaction(() => {
    run("UPDATE users SET name = ?, title = ? WHERE id = ?", displayName, title.trim(), userId);
    audit(actor.id, "UPDATE_USER_PROFILE", "USER", userId, `更新人员资料：${displayName}`);
  });
}
