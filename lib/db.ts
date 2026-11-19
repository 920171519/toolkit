import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA_SQL } from "./schema";
import { seedDatabase } from "./seed";

type SqlValue = string | number | bigint | null | Uint8Array;

const globalForDb = globalThis as unknown as { __toolkitDb?: DatabaseSync };
let localDb: DatabaseSync | undefined;

function createDatabase(): DatabaseSync {
  const databasePath = getDatabasePath();
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA busy_timeout = 5000;");
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(SCHEMA_SQL);
    migrateSchema(database);
    database.exec("COMMIT");
  } catch (error) {
    database.close();
    throw error;
  }
  if (process.env.TOOLKIT_SKIP_SEED !== "1") {
    seedDatabase(database);
  }
  return database;
}

function migrateSchema(database: DatabaseSync) {
  const projectColumns = database
    .prepare("PRAGMA table_info(projects)")
    .all() as Array<{ name: string }>;
  if (!projectColumns.some((column) => column.name === "software_manager_id")) {
    database.exec(
      "ALTER TABLE projects ADD COLUMN software_manager_id INTEGER REFERENCES users(id) ON DELETE SET NULL",
    );
  }
  database.exec(
    `UPDATE projects
     SET software_manager_id = (
       SELECT id FROM users WHERE role = 'SOFTWARE_MANAGER' AND is_active = 1 ORDER BY id LIMIT 1
     )
     WHERE software_manager_id IS NULL`,
  );
  // Existing databases predate the multi-approver pool. Backfill the primary approver
  // so node configuration and old binding requirements expose a selectable approver range.
  database.exec(
    `INSERT OR IGNORE INTO project_node_approvers (node_id, user_id, created_at)
     SELECT id, binding_approver_id, datetime('now')
     FROM project_nodes WHERE binding_approver_id IS NOT NULL`,
  );
  database.exec(
    `INSERT OR IGNORE INTO binding_requirement_approvers (requirement_id, user_id, created_at)
     SELECT br.id, pna.user_id, datetime('now')
     FROM binding_requirements br
     JOIN project_node_approvers pna ON pna.node_id = br.node_id`,
  );
  const flowColumns = database
    .prepare("PRAGMA table_info(binding_flows)")
    .all() as Array<{ name: string }>;
  if (!flowColumns.some((column) => column.name === "web_url")) {
    database.exec("ALTER TABLE binding_flows ADD COLUMN web_url TEXT");
  }
  const requestColumns = database
    .prepare("PRAGMA table_info(version_transfer_requests)")
    .all() as Array<{ name: string }>;
  if (!requestColumns.some((column) => column.name === "release_mode")) {
    database.exec("ALTER TABLE version_transfer_requests ADD COLUMN release_mode TEXT NOT NULL DEFAULT 'INTEGRATION'");
  }
  if (!requestColumns.some((column) => column.name === "risk_conclusion")) {
    database.exec("ALTER TABLE version_transfer_requests ADD COLUMN risk_conclusion TEXT");
  }
  if (!requestColumns.some((column) => column.name === "integration_status")) {
    database.exec(
      "ALTER TABLE version_transfer_requests ADD COLUMN integration_status TEXT CHECK (integration_status IN ('PENDING','IN_TEST','PASSED','FAILED','BLOCKED'))",
    );
  }
  const batchItemColumns = database
    .prepare("PRAGMA table_info(batch_items)")
    .all() as Array<{ name: string }>;
  if (!batchItemColumns.some((column) => column.name === "issue_affected")) {
    database.exec("ALTER TABLE batch_items ADD COLUMN issue_affected INTEGER NOT NULL DEFAULT 0 CHECK (issue_affected IN (0,1))");
  }
  const packageColumns = database
    .prepare("PRAGMA table_info(packages)")
    .all() as Array<{ name: string }>;
  if (!packageColumns.some((column) => column.name === "trial_overdue_days")) {
    database.exec("ALTER TABLE packages ADD COLUMN trial_overdue_days INTEGER NOT NULL DEFAULT 7");
  }
  const versionColumns = database
    .prepare("PRAGMA table_info(package_versions)")
    .all() as Array<{ name: string }>;
  for (const [name, sql] of [
    ["build_url", "ALTER TABLE package_versions ADD COLUMN build_url TEXT"],
    ["binding_mode", "ALTER TABLE package_versions ADD COLUMN binding_mode TEXT NOT NULL DEFAULT 'PENDING'"],
    ["binding_reason", "ALTER TABLE package_versions ADD COLUMN binding_reason TEXT"],
    ["binding_decided_at", "ALTER TABLE package_versions ADD COLUMN binding_decided_at TEXT"],
    ["binding_decided_by", "ALTER TABLE package_versions ADD COLUMN binding_decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL"],
    ["void_kind", "ALTER TABLE package_versions ADD COLUMN void_kind TEXT"],
    ["voided_by", "ALTER TABLE package_versions ADD COLUMN voided_by INTEGER REFERENCES users(id) ON DELETE SET NULL"],
  ]) {
    if (!versionColumns.some((column) => column.name === name)) database.exec(sql);
  }
  const requirementColumns = database
    .prepare("PRAGMA table_info(binding_requirements)")
    .all() as Array<{ name: string }>;
  for (const [name, sql] of [
    ["pushed_at", "ALTER TABLE binding_requirements ADD COLUMN pushed_at TEXT"],
    ["pushed_by", "ALTER TABLE binding_requirements ADD COLUMN pushed_by INTEGER REFERENCES users(id) ON DELETE SET NULL"],
    ["decision_reason", "ALTER TABLE binding_requirements ADD COLUMN decision_reason TEXT"],
    ["waived_at", "ALTER TABLE binding_requirements ADD COLUMN waived_at TEXT"],
    ["waived_by", "ALTER TABLE binding_requirements ADD COLUMN waived_by INTEGER REFERENCES users(id) ON DELETE SET NULL"],
  ]) {
    if (!requirementColumns.some((column) => column.name === name)) database.exec(sql);
  }
  database.exec("UPDATE package_versions SET build_url = archive_url WHERE build_url IS NULL");
  if (!requirementColumns.some((column) => column.name === "pushed_at")) {
    database.exec(
      `UPDATE binding_requirements SET pushed_at = created_at
       WHERE request_id IN (
         SELECT id FROM version_transfer_requests WHERE status IN ('TRIAL','PENDING_FORMAL','FORMAL','VOID')
       )`,
    );
  }
  if (!versionColumns.some((column) => column.name === "binding_mode")) {
    database.exec(
      `UPDATE package_versions SET binding_mode = 'PUSHED'
       WHERE status IN ('TRIAL','PENDING_FORMAL','FORMAL')
         AND EXISTS (SELECT 1 FROM binding_requirements br WHERE br.package_version_id = package_versions.id)`,
    );
  }
  database.exec(
    `INSERT OR IGNORE INTO project_pms (project_id, user_id, created_at)
     SELECT id, pm_user_id, datetime('now') FROM projects WHERE pm_user_id IS NOT NULL`,
  );
  database.exec(
    `INSERT OR IGNORE INTO project_software_managers (project_id, user_id, created_at)
     SELECT id, software_manager_id, datetime('now') FROM projects WHERE software_manager_id IS NOT NULL`,
  );
}

// The database is opened lazily. This keeps `next build` from touching the data file
// while Next is collecting page metadata in multiple build workers.
function getDatabase(): DatabaseSync {
  if (localDb) return localDb;
  if (globalForDb.__toolkitDb) {
    localDb = globalForDb.__toolkitDb;
    return localDb;
  }
  localDb = createDatabase();
  if (process.env.NODE_ENV !== "production") {
    globalForDb.__toolkitDb = localDb;
  }
  return localDb;
}

export const db: DatabaseSync = new Proxy({} as DatabaseSync, {
  get(_target, property) {
    const database = getDatabase();
    const value = Reflect.get(database, property, database);
    return typeof value === "function" ? value.bind(database) : value;
  },
});

export function all<T>(sql: string, ...params: SqlValue[]): T[] {
  return (db.prepare(sql).all(...params) as Array<Record<string, unknown>>).map(
    (row) => ({ ...row }) as T,
  );
}

export function one<T>(sql: string, ...params: SqlValue[]): T | undefined {
  const row = db.prepare(sql).get(...params) as Record<string, unknown> | undefined;
  return row ? ({ ...row } as T) : undefined;
}

export function run(sql: string, ...params: SqlValue[]) {
  return db.prepare(sql).run(...params);
}

export function transaction<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // A failed rollback should not hide the original domain/database error.
    }
    throw error;
  }
}

export function getDatabasePath(): string {
  return process.env.DATABASE_PATH
    ? path.resolve(process.env.DATABASE_PATH)
    : path.join(process.cwd(), "data", "toolkit.db");
}
