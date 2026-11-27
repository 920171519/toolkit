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

function readNodeApproverSequence(database: DatabaseSync) {
  const sequence = database.prepare(
    "SELECT seq FROM sqlite_sequence WHERE name = 'project_node_approvers'",
  ).get() as { seq: number } | undefined;
  return sequence?.seq ?? 0;
}

test("仅补齐缺失的主审批人，重复启动不消耗新的记录编号", ({}, testInfo) => {
  const databasePath = testInfo.outputPath("toolkit.db");
  openInNewProcess(databasePath);
  const database = new DatabaseSync(databasePath);
  const fixture = (() => {
    try {
      const primary = database.prepare(
        `SELECT a.id, a.node_id AS nodeId, a.user_id AS userId
         FROM project_nodes n
         JOIN project_node_approvers a ON a.node_id = n.id AND a.user_id = n.binding_approver_id
         ORDER BY a.id LIMIT 1`,
      ).get() as { id: number; nodeId: number; userId: number } | undefined;
      if (!primary) throw new Error("演示数据库缺少主审批人配置。");
      const sequence = readNodeApproverSequence(database);
      database.prepare("DELETE FROM project_node_approvers WHERE id = ?").run(primary.id);
      return { ...primary, sequence };
    } finally {
      database.close();
    }
  })();

  for (let restart = 0; restart < 2; restart += 1) {
    openInNewProcess(databasePath);
    const reopened = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const restored = reopened.prepare(
        "SELECT id FROM project_node_approvers WHERE node_id = ? AND user_id = ?",
      ).get(fixture.nodeId, fixture.userId);
      expect(restored).toEqual({ id: fixture.sequence + 1 });
      expect(readNodeApproverSequence(reopened)).toBe(fixture.sequence + 1);
    } finally {
      reopened.close();
    }
  }
});

test("旧库重启补齐节点电子流索引并保留已有单据", ({}, testInfo) => {
  const databasePath = testInfo.outputPath("toolkit.db");
  openInNewProcess(databasePath);
  const readFlows = (database: DatabaseSync) => database.prepare(
    "SELECT id, requirement_id AS requirementId, flow_no AS flowNo, status FROM binding_flows ORDER BY id",
  ).all();

  const database = new DatabaseSync(databasePath);
  const before = (() => {
    try {
      const flows = readFlows(database);
      expect(flows.length).toBeGreaterThan(0);
      database.exec("DROP INDEX IF EXISTS idx_binding_flows_requirement");
      return flows;
    } finally {
      database.close();
    }
  })();

  for (let restart = 0; restart < 2; restart += 1) {
    openInNewProcess(databasePath);
    const reopened = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const columns = reopened.prepare("PRAGMA index_info(idx_binding_flows_requirement)").all();
      expect(columns.map(({ name }) => name)).toEqual(["requirement_id"]);
      expect(readFlows(reopened)).toEqual(before);
    } finally {
      reopened.close();
    }
  }
});
