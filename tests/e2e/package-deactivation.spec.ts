import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test, type TestInfo } from "@playwright/test";
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
      ...load(resolve("lib/area-settings.ts")) as typeof import("../../lib/area-settings"),
      ...load(resolve("lib/package-settings.ts")) as typeof import("../../lib/package-settings"),
      ...load(resolve("lib/transfer-workflow.ts")) as typeof import("../../lib/transfer-workflow"),
      ...load(resolve("lib/user-settings.ts")) as typeof import("../../lib/user-settings"),
    };
  } finally {
    runtime.__toolkitDb = previous;
  }
}

const actor: SessionUser = { id: 1, role: "ADMIN", name: "验收管理员", employeeId: "QA001", department: "", title: "" };

function withConnections(testInfo: TestInfo, run: (first: DatabaseSync, second: DatabaseSync) => void) {
  const path = testInfo.outputPath("toolkit.db");
  execFileSync(process.execPath, ["--import", "tsx", "scripts/seed-db.ts"], {
    env: { ...process.env, DATABASE_PATH: path, TOOLKIT_SKIP_SEED: "1" },
    timeout: 15_000,
  });
  const first = new DatabaseSync(path);
  const second = new DatabaseSync(path);
  try {
    first.exec(`
      INSERT INTO users (id, name, employee_id, password_hash, role, created_at)
      VALUES (1, '验收管理员', 'QA001', 'fixture', 'ADMIN', '2026-11-28'),
             (2, '验收成员', 'QA002', 'fixture', 'MEMBER', '2026-11-28');
      INSERT INTO projects (id, name, code, created_at) VALUES (1, '验收项目', 'Q1', '2026-11-28');
      INSERT INTO project_nodes (id, project_id, name) VALUES (1, 1, 'EVT');
    `);
    run(first, second);
  } finally {
    second.close();
    first.close();
  }
}

test("抽屉保存停用前重新核对并发启用的软件包及新增转测申请", ({}, testInfo) => {
  withConnections(testInfo, (first, second) => {
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
  });
});

const ownerUnavailable = "责任人不存在或已停用。";
const packageInput = {
  name: "责任人与账号停用验收",
  code: "93153QAT",
  description: "原始的软件包说明",
  areaId: null,
  ownerId: actor.id,
  trialOverdueDays: 7,
  isActive: true,
};

function beforeNextWrite(connection: DatabaseSync, operation: () => void) {
  const exec = connection.exec.bind(connection);
  connection.exec = (statement) => {
    if (statement === "BEGIN IMMEDIATE") {
      connection.exec = exec;
      operation();
    }
    exec(statement);
  };
}

test("历史补录按写入时已经存在的版本号核对大小写", ({}, testInfo) => {
  withConnections(testInfo, (first, second) => {
    const firstCommand = loadCommands(first);
    const secondCommand = loadCommands(second);
    const packageId = firstCommand.savePackage(actor, packageInput);
    const input = {
      packageId,
      version: "2.0.0-RC",
      status: "FORMAL" as const,
      changeSummary: "历史补录版本对照",
      archiveUrl: "https://example.test/package",
      buildUrl: "https://example.test/build",
      formFlowNo: "EF-LEGACY-QA",
      formalReleasedAt: "2026-01-01T00:00:00Z",
      trialFormNo: "",
      trialReleasedAt: "",
    };

    let versionId: number | undefined;
    beforeNextWrite(first, () => {
      versionId = secondCommand.importLegacyVersion(actor, input);
    });
    expect(() => firstCommand.importLegacyVersion(actor, { ...input, version: "2.0.0-rc" }))
      .toThrow("该软件包已存在相同版本号。");
    expect(second.prepare("SELECT id, version FROM package_versions WHERE package_id = ?").all(packageId))
      .toEqual([{ id: versionId, version: "2.0.0-RC" }]);
    expect(second.prepare("SELECT entity_id FROM audit_logs WHERE action = 'IMPORT_LEGACY_VERSION'").all())
      .toEqual([{ entity_id: versionId }]);
  });
});

for (const [operation, label] of [["create", "新建软件包"], ["edit", "保存软件包配置"], ["drawer", "抽屉保存责任人"]] as const) {
  test(label + "按写入时账号状态校验责任人", ({}, testInfo) => {
    withConnections(testInfo, (first, second) => {
      const packages = loadCommands(first);
      const users = loadCommands(second);
      const originalId = operation === "create" ? undefined : users.savePackage(actor, packageInput);
      const newOwner = { ...packageInput, ownerId: 2, description: "分配新的责任人" };
      const writePackage = () => {
        if (operation === "drawer") {
          assert(originalId !== undefined);
          return packages.updatePackageResponsibility(actor, originalId, newOwner);
        }
        return packages.savePackage(actor, { ...newOwner, id: originalId });
      };
      const getPackage = () => second.prepare("SELECT owner_id AS owner, description FROM packages WHERE code = ?").get(packageInput.code);
      const getUser = () => second.prepare("SELECT is_active AS active FROM users WHERE id = 2").get();

      beforeNextWrite(first, () => users.setUserActive(actor, 2, false));
      expect(writePackage).toThrow(ownerUnavailable);
      expect(getUser()).toEqual({ active: 0 });
      expect(getPackage()).toEqual(originalId === undefined ? undefined : { owner: actor.id, description: packageInput.description });
      const audit = second.prepare(
        "SELECT action FROM audit_logs WHERE entity_type = 'PACKAGE' ORDER BY id",
      );
      expect(audit.all()).toEqual(originalId === undefined ? [] : [{ action: "CREATE_PACKAGE" }]);

      users.setUserActive(actor, 2, true);
      writePackage();
      expect(getPackage()).toEqual({ owner: 2, description: newOwner.description });
      expect(() => users.setUserActive(actor, 2, false)).toThrow("该人员仍负责启用中的软件包，请先转移责任人。");
      expect(getUser()).toEqual({ active: 1 });
    });
  });
}

test("账号停用保留停用软件包的责任人历史，重新保存时仍要求启用的责任人", ({}, testInfo) => {
  withConnections(testInfo, (first, second) => {
    const packages = loadCommands(first);
    const users = loadCommands(second);
    const historical = { ...packageInput, ownerId: 2, isActive: false };
    const id = packages.savePackage(actor, historical);
    users.setUserActive(actor, 2, false);
    expect(first.prepare("SELECT owner_id AS owner, is_active AS active FROM packages WHERE id = ?").get(id))
      .toEqual({ owner: 2, active: 0 });
    expect(() => packages.savePackage(actor, { ...historical, id, areaId: 999 })).toThrow(ownerUnavailable);
    expect(() => packages.updatePackageResponsibility(actor, id, historical)).toThrow(ownerUnavailable);
    expect(() => packages.savePackage(actor, { ...historical, id, isActive: true })).toThrow(ownerUnavailable);
  });
});

test("删除责任田按写入时的软件包归属核对是否允许删除", ({}, testInfo) => {
  withConnections(testInfo, (first, second) => {
    const areas = loadCommands(first);
    const packages = loadCommands(second);
    const areaId = areas.saveArea(actor, { name: "归属验证责任田", description: "" });
    const emptyAreaId = areas.saveArea(actor, { name: "待删除责任田", description: "" });
    const missingAreaMessage = "责任田不存在。";
    const blockedMessage = "该责任田下仍有软件包，请先调整软件包归属后再删除。";
    const packageInArea = { ...packageInput, areaId };
    let packageId: number | undefined;

    // The existence and reference checks must run after the write lock is acquired.
    const prepare = first.prepare.bind(first);
    first.prepare = (statement) => {
      if (statement === "SELECT id, name FROM areas WHERE id = ?"
        || statement === "SELECT COUNT(*) AS count FROM packages WHERE area_id = ?") {
        expect(first.isTransaction).toBe(true);
      }
      return prepare(statement);
    };

    beforeNextWrite(first, () => {
      packageId = packages.savePackage(actor, packageInArea);
    });
    expect(() => areas.deleteArea(actor, areaId)).toThrow(blockedMessage);
    assert(packageId !== undefined);
    expect(first.isTransaction).toBe(false);
    expect(second.prepare("SELECT area_id FROM packages WHERE id = ?").get(packageId)).toEqual({ area_id: areaId });
    expect(second.prepare("SELECT id FROM areas WHERE id = ?").get(areaId)).toEqual({ id: areaId });

    packages.savePackage(actor, { ...packageInArea, id: packageId, isActive: false });
    expect(() => areas.deleteArea(actor, areaId)).toThrow(blockedMessage);
    expect(() => areas.deleteArea({ ...actor, id: 2, role: "MEMBER" }, emptyAreaId))
      .toThrow("只有系统管理员可以删除责任田。");

    const deletedAreaEdit = { ...packageInArea, id: packageId, areaId: emptyAreaId };
    beforeNextWrite(second, () => areas.deleteArea(actor, emptyAreaId));
    expect(() => packages.savePackage(actor, deletedAreaEdit)).toThrow(missingAreaMessage);
    expect(() => areas.deleteArea(actor, emptyAreaId)).toThrow(missingAreaMessage);
    expect(second.prepare("SELECT area_id, is_active FROM packages WHERE id = ?").get(packageId))
      .toEqual({ area_id: areaId, is_active: 0 });
    expect(second.prepare("SELECT entity_id FROM audit_logs WHERE action = 'DELETE_AREA' ORDER BY id").all())
      .toEqual([{ entity_id: emptyAreaId }]);
    expect(second.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
