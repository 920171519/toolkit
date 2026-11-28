import { spawnSync } from "node:child_process";
import { expect, test } from "@playwright/test";

test("草稿标题和配套修订号来自同一次读取，拒绝覆盖并发修改", ({}, testInfo) => {
  const probe = String.raw`
    const assert = require("node:assert/strict");
    const { execFileSync } = require("node:child_process");
    const { DatabaseSync } = require("node:sqlite");
    const load = [
      'const Module = require("node:module");',
      'const resolveModule = Module._resolveFilename;',
      'Module._resolveFilename = function(name, ...args) {',
      '  return resolveModule.call(this, name === "server-only" ? "next/dist/compiled/server-only/empty" : name, ...args);',
      '};',
      'const { db } = require("./lib/db.ts");',
      'const { createBatchDraft } = require("./lib/batch-workflow.ts");',
      'const manager = db.prepare("SELECT id, role, name, employee_id AS employeeId FROM users WHERE employee_id = ?").get("MGR001");',
    ].join("\n");
    const { db, createBatchDraft, manager } = new Function("require", load + "\nreturn { db, createBatchDraft, manager };")(require);
    const { getBatchForPreparation } = require("./lib/batch-queries.ts");
    const selection = db.prepare(
      "SELECT p.id AS packageId, v.id AS packageVersionId FROM version_transfer_requests r " +
      "JOIN package_versions v ON v.id = r.package_version_id JOIN packages p ON p.id = v.package_id " +
      "WHERE r.project_id = 1 AND r.status = 'PENDING' AND p.name = '1005SEC'"
    ).get();
    assert(selection);

    const input = { projectId: 1, code: "B9981", title: "Original draft title", items: [selection] };
    const batchId = createBatchDraft(manager, input);
    const first = getBatchForPreparation(manager, batchId, 1).draft;
    const peerEdit = { ...input, draftBatchId: batchId, expectedDraftRevision: first.revision, title: "Concurrent title" };
    let peerSaved = false;

    // Commit the peer edit immediately after the reader fetches the draft header.
    const prepare = DatabaseSync.prototype.prepare;
    DatabaseSync.prototype.prepare = function(sql) {
      const statement = prepare.call(this, sql);
      if (!peerSaved && sql.includes("b.title") && sql.includes("FROM integration_batches b")) {
        for (const method of ["get", "all"]) {
          const read = statement[method].bind(statement);
          statement[method] = (...args) => {
            const rows = read(...args);
            execFileSync(process.execPath, ["-r", "tsx/cjs", "-"], {
              input: load + "\ncreateBatchDraft(manager, JSON.parse(process.env.TOOLKIT_TEST_PEER_DRAFT));",
              env: { ...process.env, TOOLKIT_TEST_PEER_DRAFT: JSON.stringify(peerEdit) },
              timeout: 15_000,
            });
            peerSaved = true;
            return rows;
          };
        }
      }
      return statement;
    };

    let draft;
    try {
      draft = getBatchForPreparation(manager, batchId, 1).draft;
    } finally {
      DatabaseSync.prototype.prepare = prepare;
    }
    assert(peerSaved);
    const latest = getBatchForPreparation(manager, batchId, 1).draft;
    assert.equal(latest.title, peerEdit.title);
    assert(latest.revision > first.revision);
    assert.deepEqual(draft, first);
    assert.throws(() => createBatchDraft(manager, {
      ...input, draftBatchId: batchId, expectedDraftRevision: draft.revision,
    }), /此草稿已被其他操作更新/);
    assert.deepEqual(getBatchForPreparation(manager, batchId, 1).draft, latest);

    // SQLite affinity leaves existing BLOB values untouched when decoding native rows.
    db.prepare("UPDATE batch_items SET is_changed = ? WHERE batch_id = ?").run(new Uint8Array([10]), batchId);
    assert.equal(getBatchForPreparation(manager, batchId, 1).draft.items[0].isChanged, true);
  `;
  const database = testInfo.outputPath("draft-read-snapshot.db");
  const result = spawnSync(process.execPath, ["-r", "tsx/cjs", "-"], {
    input: probe,
    env: { ...process.env, DATABASE_PATH: database, TOOLKIT_SKIP_SEED: "0" },
    encoding: "utf8",
    timeout: 30_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
});
