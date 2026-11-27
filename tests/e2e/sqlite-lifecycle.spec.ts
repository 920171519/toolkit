import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";
import { closeDatabaseAfterError, withImmediateTransaction } from "../../lib/sqlite-lifecycle";

test("SQLite 写事务保留返回值，开启失败时保留已有事务", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec("CREATE TABLE fixture (value INTEGER);");
    const result = { recorded: true };
    expect(withImmediateTransaction(database, () => {
      database.exec("INSERT INTO fixture VALUES (1);");
      expect(() => withImmediateTransaction(database, () => database.exec("INSERT INTO fixture VALUES (2);"))).toThrow();
      return result;
    })).toBe(result);
    expect(withImmediateTransaction(database, () => database.prepare("SELECT value FROM fixture").all()))
      .toEqual([{ value: 1 }]);
  } finally {
    database.close();
  }
});

test("SQLite 自动回滚或关闭连接失败后保留原始错误", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(`
      CREATE TABLE fixture (value INTEGER);
      CREATE TRIGGER fail_fixture BEFORE INSERT ON fixture WHEN NEW.value = 2
      BEGIN SELECT RAISE(ROLLBACK, 'fixture write refused'); END;
    `);
    expect(() => withImmediateTransaction(database, () => {
      database.exec("INSERT INTO fixture VALUES (1), (2);");
    })).toThrow("fixture write refused");
    expect(withImmediateTransaction(database, () => database.prepare("SELECT value FROM fixture").all()))
      .toEqual([]);
  } finally {
    database.close();
  }

  const original = new Error("fixture failed before close");
  assert.throws(() => closeDatabaseAfterError(database, original), (error) => error === original);
});

test("补派预览无法确认 SQLite 只读时在打开目标前退出", ({}, testInfo) => {
  const target = testInfo.outputPath("toolkit.db");
  const preloader = testInfo.outputPath("sqlite-ignores-read-only.cjs");
  writeFileSync(target, "");
  // Simulate a runtime that accepts the option without enforcing it.
  writeFileSync(preloader, `
    const sqlite = require("node:sqlite");
    const DatabaseSync = sqlite.DatabaseSync;
    sqlite.DatabaseSync = class extends DatabaseSync {
      constructor(path, options) {
        if (path !== ":memory:") throw new Error("fixture target opened");
        super(path, { ...options, readOnly: false });
      }
    };
    require("node:module").syncBuiltinESMExports();
  `);

  const preview = spawnSync(process.execPath, [
    "--require", preloader, "--import", "tsx",
    "scripts/backfill-trial-transfer-requests.ts", "--database", target,
  ], { encoding: "utf8", timeout: 15_000 });
  expect(preview.error).toBeUndefined();
  expect(preview.status).toBe(1);
  expect(preview.stdout).toBe("");
  expect(preview.stderr).toContain("无法确认 SQLite 只读模式");
  expect(preview.stderr).not.toContain("fixture target opened");
});
