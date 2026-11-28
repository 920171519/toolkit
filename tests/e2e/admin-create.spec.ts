import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";

test("管理员维护命令记录账号创建与更新，审计失败时回滚账号写入", ({}, testInfo) => {
  const databasePath = testInfo.outputPath("admin-create.db");
  const reportsPath = testInfo.outputPath("reports");
  const runCommand = (name: string, employeeId: string, password: string) => {
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/create-admin.ts", "--", name, employeeId, password], {
      env: { ...process.env, DATABASE_PATH: databasePath, TOOLKIT_REPORTS_PATH: reportsPath, TOOLKIT_SKIP_SEED: "1" },
      encoding: "utf8",
      timeout: 15_000,
    });
    expect(result.error).toBeUndefined();
    return result;
  };

  const employeeId = "ADMINQA001";
  const created = runCommand("维护演练管理员", employeeId, "InitialQaPassword");
  expect(created.status).toBe(0);
  expect(created.stdout).toContain("已创建系统管理员 维护演练管理员（ADMINQA001）");

  const database = new DatabaseSync(databasePath);
  try {
    database.exec("PRAGMA foreign_keys = ON;");
    const selectAccount = database.prepare(
      "SELECT id, name, role, is_active AS active, title, password_hash AS passwordHash FROM users WHERE employee_id = ?",
    );
    const selectAudits = database.prepare(
      "SELECT action, actor_id AS actorId, entity_type AS entityType, entity_id AS entityId, detail FROM audit_logs ORDER BY id",
    );
    const first = selectAccount.get(employeeId) as { id: number; passwordHash: string };
    const createAudit = {
      action: "CLI_CREATE_ADMIN",
      actorId: null,
      entityType: "USER",
      entityId: first.id,
      detail: "维护命令创建系统管理员账号：维护演练管理员",
    };
    expect(first).toMatchObject({ name: "维护演练管理员", role: "ADMIN", active: 1, title: "系统管理员" });
    expect(selectAudits.all()).toEqual([createAudit]);
    database.prepare("UPDATE users SET role = 'MEMBER', is_active = 0 WHERE id = ?").run(first.id);
    database.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .run("admin-cli-fixture-session", first.id, "2036-04-01T00:00:00Z", "2026-04-01T00:00:00Z");

    const updated = runCommand("更新后管理员", employeeId, "DifferentQaPassword");
    expect(updated.status).toBe(0);
    expect(updated.stdout).toContain("已将现有账号 ADMINQA001（维护演练管理员）提升为系统管理员，密码保持不变。");
    const current = selectAccount.get(employeeId);
    const updateAudit = { ...createAudit, action: "CLI_UPDATE_ADMIN", detail: "维护命令更新系统管理员账号：更新后管理员" };
    expect(current).toMatchObject({ id: first.id, name: "更新后管理员", role: "ADMIN", active: 1, title: "系统管理员" });
    expect(current?.passwordHash === first.passwordHash).toBe(true);
    expect(database.prepare("SELECT user_id AS userId FROM sessions").all()).toEqual([{ userId: first.id }]);
    expect(selectAudits.all()).toEqual([createAudit, updateAudit]);

    database.prepare("UPDATE users SET role = 'MEMBER', is_active = 0, title = '回滚前职务' WHERE id = ?").run(first.id);
    database.exec(
      `CREATE TRIGGER reject_admin_audit BEFORE INSERT ON audit_logs
       WHEN NEW.action IN ('CLI_CREATE_ADMIN', 'CLI_UPDATE_ADMIN')
       BEGIN SELECT RAISE(ABORT, '管理员审计写入校验失败'); END;`,
    );
    const failure = runCommand("审计失败时的名字", employeeId, "DifferentQaPassword");
    expect(failure.status).toBe(1);
    expect(failure.stderr).toContain("管理员审计写入校验失败");
    expect(selectAccount.get(employeeId)).toMatchObject({
      id: first.id, name: "更新后管理员", role: "MEMBER", active: 0, title: "回滚前职务",
    });

    const secondId = "ADMINQA002";
    const failedCreate = runCommand("审计失败的账号", secondId, "InitialQaPassword");
    expect(failedCreate.status).toBe(1);
    expect(failedCreate.stderr).toContain("管理员审计写入校验失败");
    expect(selectAccount.get(secondId)).toBeUndefined();
    expect(selectAudits.all()).toEqual([createAudit, updateAudit]);
  } finally {
    database.close();
  }
});
