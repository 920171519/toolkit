import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";

function openInNewProcess(databasePath: string) {
  execFileSync(process.execPath, ["--import", "tsx", "scripts/seed-db.ts"], {
    env: { ...process.env, DATABASE_PATH: databasePath, TOOLKIT_SKIP_SEED: "0" },
    timeout: 15_000,
  });
}

function readSnapshots(database: DatabaseSync, issuedId: number, legacyId: number) {
  return database.prepare(
    `SELECT id, requirement_id AS requirementId, user_id AS userId, created_at AS createdAt
     FROM binding_requirement_approvers WHERE requirement_id IN (?, ?) ORDER BY id`,
  ).all(issuedId, legacyId);
}

test("重新启动保留既有审批快照及旧记录主审批人", ({}, testInfo) => {
  const databasePath = testInfo.outputPath("toolkit.db");
  openInNewProcess(databasePath);
  const database = new DatabaseSync(databasePath);
  const fixture = (() => {
    try {
      const requirements = database.prepare(
        `SELECT br.id, br.node_id AS nodeId, br.approver_id AS approverId
         FROM binding_requirements br
         WHERE br.approver_id IS NOT NULL
           AND EXISTS (SELECT 1 FROM binding_requirement_approvers a WHERE a.requirement_id = br.id)
         ORDER BY br.id LIMIT 2`,
      ).all() as Array<{ id: number; nodeId: number; approverId: number }>;
      expect(requirements).toHaveLength(2);
      const [issued, legacy] = requirements;
      database.prepare("DELETE FROM binding_requirement_approvers WHERE requirement_id = ?").run(legacy.id);
      const snapshots = readSnapshots(database, issued.id, legacy.id);
      expect(snapshots.length).toBeGreaterThan(0);
      expect(snapshots.every(({ requirementId }) => requirementId === issued.id)).toBe(true);

      const newApprover = database.prepare(
        `INSERT INTO users (name, employee_id, password_hash, created_at)
         VALUES ('审批配置测试员', 'SNAPSHOT-QA', 'fixture-only', datetime('now'))`,
      ).run().lastInsertRowid;
      const addApprover = database.prepare(
        `INSERT INTO project_node_approvers (node_id, user_id, created_at)
         VALUES (?, ?, datetime('now'))`,
      );
      for (const nodeId of new Set(requirements.map(({ nodeId }) => nodeId))) {
        addApprover.run(nodeId, newApprover);
      }
      return { issued, legacy, snapshots };
    } finally {
      database.close();
    }
  })();

  for (let restart = 0; restart < 2; restart += 1) {
    openInNewProcess(databasePath);
    const reopened = new DatabaseSync(databasePath, { readOnly: true });
    try {
      expect(readSnapshots(reopened, fixture.issued.id, fixture.legacy.id)).toEqual(fixture.snapshots);
      expect(reopened.prepare("SELECT approver_id AS approverId FROM binding_requirements WHERE id = ?")
        .get(fixture.legacy.id)).toEqual({ approverId: fixture.legacy.approverId });
    } finally {
      reopened.close();
    }
  }
});
