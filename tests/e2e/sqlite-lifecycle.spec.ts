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

test("旧库缺少软件经理列时首次启动补齐索引并保留项目", ({}, testInfo) => {
  const target = testInfo.outputPath("legacy-project.db");
  const legacy = new DatabaseSync(target);
  try {
    legacy.exec(`
      PRAGMA foreign_keys = OFF;
      CREATE TABLE projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        code TEXT NOT NULL UNIQUE COLLATE NOCASE,
        description TEXT NOT NULL DEFAULT '',
        pm_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAUSED','ARCHIVED')),
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      INSERT INTO projects (id, name, code, description, status, sort_order, created_at)
      VALUES (7, '旧版项目', 'LEGACY-P', '原始项目说明', 'ARCHIVED', 4, '2024-01-01');
    `);
  } finally {
    legacy.close();
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const startup = spawnSync(process.execPath, ["--import", "tsx", "scripts/seed-db.ts"], {
      env: { ...process.env, DATABASE_PATH: target, TOOLKIT_SKIP_SEED: "1" },
      encoding: "utf8",
      timeout: 15_000,
    });
    expect(startup.error).toBeUndefined();
    expect(startup.status, startup.stderr).toBe(0);

    const migrated = new DatabaseSync(target, { readOnly: true });
    try {
      expect(migrated.prepare("SELECT * FROM projects").all()).toEqual([{
        id: 7,
        name: "旧版项目",
        code: "LEGACY-P",
        description: "原始项目说明",
        pm_user_id: null,
        software_manager_id: null,
        status: "ARCHIVED",
        stage: "TR1",
        sort_order: 4,
        created_at: "2024-01-01",
      }]);
      expect(migrated.prepare("PRAGMA index_list(projects)").all()).toContainEqual(
        expect.objectContaining({ name: "idx_projects_manager", unique: 0, origin: "c", partial: 0 }),
      );
      expect(migrated.prepare("PRAGMA index_info(idx_projects_manager)").all()).toEqual([
        expect.objectContaining({ name: "software_manager_id" }),
      ]);
      expect(migrated.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      migrated.close();
    }
  }
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

test("旧库启动补齐批次版本索引并保留配套快照", ({}, testInfo) => {
  const target = testInfo.outputPath("legacy-batch-history.db");
  function start(seed: boolean) {
    const startup = spawnSync(process.execPath, ["--import", "tsx", "scripts/seed-db.ts"], {
      env: { ...process.env, DATABASE_PATH: target, TOOLKIT_SKIP_SEED: seed ? "0" : "1" },
      encoding: "utf8",
      timeout: 15_000,
    });
    expect(startup.error).toBeUndefined();
    expect(startup.status, startup.stderr).toBe(0);
  }

  start(true);
  const legacy = new DatabaseSync(target);
  let before: unknown[];
  try {
    legacy.exec("DROP INDEX IF EXISTS idx_batch_items_version");
    before = legacy.prepare("SELECT * FROM batch_items ORDER BY id").all();
    expect(before.length).toBeGreaterThan(0);
  } finally {
    legacy.close();
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    start(false);
    const migrated = new DatabaseSync(target, { readOnly: true });
    try {
      expect(migrated.prepare("PRAGMA index_info(idx_batch_items_version)").all()).toEqual([
        expect.objectContaining({ name: "package_version_id" }),
      ]);
      expect(migrated.prepare("SELECT * FROM batch_items ORDER BY id").all()).toEqual(before);
      expect(migrated.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      migrated.close();
    }
  }
});

test("旧电子流条码按原有分隔符补录并使用同一判定约束", ({}, testInfo) => {
  const target = testInfo.outputPath("legacy-barcode-review.db");
  function start(seed: boolean) {
    const startup = spawnSync(process.execPath, ["--import", "tsx", "scripts/seed-db.ts"], {
      env: { ...process.env, DATABASE_PATH: target, TOOLKIT_SKIP_SEED: seed ? "0" : "1" },
      encoding: "utf8",
      timeout: 15_000,
    });
    expect(startup.error).toBeUndefined();
    expect(startup.status, startup.stderr).toBe(0);
  }

  start(true);
  const legacy = new DatabaseSync(target);
  let flow: { id: number; submittedAt: string };
  try {
    const first = legacy.prepare("SELECT id, submitted_at AS submittedAt FROM binding_flows ORDER BY id LIMIT 1").get() as typeof flow | undefined;
    assert.ok(first);
    flow = first;
    legacy.exec(`
      ALTER TABLE binding_flow_barcodes DROP COLUMN validation_result;
      ALTER TABLE binding_flow_barcodes DROP COLUMN validated_at;
      ALTER TABLE binding_flow_barcodes DROP COLUMN validated_by;
      ALTER TABLE binding_flow_barcodes DROP COLUMN failure_reason;
      ALTER TABLE binding_flow_barcodes DROP COLUMN failure_reason_at;
      ALTER TABLE binding_flow_barcodes DROP COLUMN failure_reason_by;
    `);
    legacy.prepare("DELETE FROM binding_flow_barcodes WHERE flow_id = ?").run(flow.id);
    legacy.prepare("UPDATE binding_flows SET device_barcode = ? WHERE id = ?")
      .run(" LEGACY-A,\r\n LEGACY-B；LEGACY-A;legacy-a ， ", flow.id);
  } finally {
    legacy.close();
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    start(false);
    const migrated = new DatabaseSync(target);
    try {
      expect(migrated.prepare(`
        SELECT barcode, validation_result, validated_at, validated_by,
               failure_reason, failure_reason_at, failure_reason_by, created_at
        FROM binding_flow_barcodes WHERE flow_id = ? ORDER BY id
      `).all(flow.id)).toEqual(["LEGACY-A", "LEGACY-B", "legacy-a"].map((barcode) => ({
        barcode,
        validation_result: "UNREVIEWED",
        validated_at: null,
        validated_by: null,
        failure_reason: null,
        failure_reason_at: null,
        failure_reason_by: null,
        created_at: flow.submittedAt,
      })));
      expect(() => migrated.prepare("UPDATE binding_flow_barcodes SET validation_result = 'OTHER' WHERE flow_id = ?")
        .run(flow.id)).toThrow(/CHECK constraint failed/);
      expect(migrated.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      migrated.close();
    }
  }
});
