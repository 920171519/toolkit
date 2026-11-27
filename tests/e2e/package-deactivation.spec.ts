import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";
import ts from "typescript";
import type { SessionUser } from "../../lib/types";

function loadCommands(connection: DatabaseSync) {
  // Each command module needs its own application DB cache for the two real SQLite connections.
  const modules = new Map<string, { exports: unknown }>();
  function load(filename: string): unknown {
    const existing = modules.get(filename);
    if (existing) return existing.exports;
    const entry = { exports: {} };
    modules.set(filename, entry);
    const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    const nativeRequire = createRequire(filename);
    const require = (specifier: string): unknown => {
      if (specifier === "server-only") return {};
      if (specifier.startsWith(".")) return load(resolve(dirname(filename), specifier + ".ts"));
      return nativeRequire(specifier);
    };
    new Function("require", "module", "exports", outputText)(require, entry, entry.exports);
    return entry.exports;
  }

  const runtime = globalThis as typeof globalThis & { __toolkitDb?: DatabaseSync };
  const previous = runtime.__toolkitDb;
  runtime.__toolkitDb = connection;
  try {
    const { db } = load(resolve("lib/db.ts")) as typeof import("../../lib/db");
    db.prepare("SELECT 1").get();
    return {
      ...load(resolve("lib/package-settings.ts")) as typeof import("../../lib/package-settings"),
      ...load(resolve("lib/transfer-workflow.ts")) as typeof import("../../lib/transfer-workflow"),
    };
  } finally {
    runtime.__toolkitDb = previous;
  }
}

test("抽屉保存停用前重新核对并发启用的软件包及新增转测申请", ({}, testInfo) => {
  const path = testInfo.outputPath("toolkit.db");
  execFileSync(process.execPath, ["--import", "tsx", "scripts/seed-db.ts"], {
    env: { ...process.env, DATABASE_PATH: path, TOOLKIT_SKIP_SEED: "1" },
    timeout: 15_000,
  });
  const first = new DatabaseSync(path);
  const second = new DatabaseSync(path);
  try {
    const actor: SessionUser = { id: 1, role: "ADMIN", name: "验收管理员", employeeId: "QA001", department: "", title: "" };
    first.exec(`
      INSERT INTO users (id, name, employee_id, password_hash, role, created_at)
      VALUES (1, '验收管理员', 'QA001', 'fixture', 'ADMIN', '2026-11-28');
      INSERT INTO projects (id, name, code, created_at) VALUES (1, '验收项目', 'Q1', '2026-11-28');
      INSERT INTO project_nodes (id, project_id, name) VALUES (1, 1, 'EVT');
    `);
    const drawer = loadCommands(first);
    const configuration = loadCommands(second);
    const pkg = { code: "93152QAT", name: "停用并发验证", description: "停用前的软件包说明", areaId: null, ownerId: actor.id, trialOverdueDays: 7, isActive: false };
    const packageId = configuration.savePackage(actor, pkg);
    configuration.savePackageUsages(actor, packageId, [1]);

    // Complete ordinary activation and transfer while the drawer has read the old state,
    // before its connection begins the write transaction.
    const begin = first.exec.bind(first);
    let transferVersionId: number | undefined;
    first.exec = (statement) => {
      if (statement === "BEGIN IMMEDIATE") {
        expect(transferVersionId).toBeUndefined();
        configuration.savePackage(actor, { ...pkg, id: packageId, isActive: true });
        const transfer = configuration.submitTransfer(actor, {
          packageId, version: "1.0.1", changeSummary: "新增版本转测验证",
          archiveUrl: "https://example.test/package", buildUrl: "https://example.test/build",
        });
        expect(transfer.projectCount).toBe(1);
        transferVersionId = transfer.versionId;
      }
      begin(statement);
    };
    const deactivate = () => drawer.updatePackageResponsibility(actor, packageId, {
      ownerId: actor.id, description: "抽屉里较早的保存", isActive: false,
    });
    expect.soft(deactivate).toThrow("该软件包仍有未转正版本记录，不能停用。");
    assert(transferVersionId !== undefined);
    expect.soft(second.prepare("SELECT is_active AS active, description FROM packages WHERE id = ?").get(packageId))
      .toEqual({ active: 1, description: pkg.description });
    expect(second.prepare("SELECT status FROM version_transfer_requests WHERE package_version_id = ?").get(transferVersionId))
      .toEqual({ status: "PENDING" });
    expect.soft(second.prepare("SELECT 1 FROM audit_logs WHERE action = 'UPDATE_PACKAGE_RESPONSIBILITY' AND entity_id = ?").get(packageId))
      .toBeUndefined();
  } finally {
    second.close();
    first.close();
  }
});
