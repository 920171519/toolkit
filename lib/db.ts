import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getDatabasePath, shouldSeedDemoData } from "./runtime-config";
import {
  PACKAGE_VERSION_BUILD_URL_COLUMN_SQL,
  PROJECT_STAGE_COLUMN_SQL,
  SCHEMA_SQL,
  TRANSFER_REQUEST_RELEASE_MODE_COLUMN_SQL,
  TRANSFER_REQUEST_RISK_CONCLUSION_COLUMN_SQL,
} from "./schema";
import { seedDatabase } from "./seed";
import { closeDatabaseAfterError, withImmediateTransaction } from "./sqlite-lifecycle";
import { refreshProjectTrialReadiness, refreshTrialReadiness } from "./trial-readiness";

type SqlValue = string | number | bigint | null | Uint8Array;

const globalForDb = globalThis as unknown as { __toolkitDb?: DatabaseSync };
let localDb: DatabaseSync | undefined;

function createDatabase(): DatabaseSync {
  const databasePath = getDatabasePath();
  mkdirSync(dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  try {
    database.exec("PRAGMA busy_timeout = 5000;");
    database.exec("PRAGMA foreign_keys = ON;");
    database.exec("PRAGMA journal_mode = WAL;");
    withImmediateTransaction(database, () => {
      database.exec(SCHEMA_SQL);
      migrateSchema(database);
      refreshProjectTrialReadiness(database, new Date().toISOString());
    });
    if (shouldSeedDemoData()) seedDatabase(database);
  } catch (error) {
    closeDatabaseAfterError(database, error);
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
  database.exec("CREATE INDEX IF NOT EXISTS idx_projects_manager ON projects(software_manager_id);");
  if (!projectColumns.some((column) => column.name === "stage")) {
    database.exec(`ALTER TABLE projects ADD COLUMN ${PROJECT_STAGE_COLUMN_SQL}`);
  }
  // Backfill the current node pool from the primary approver in older databases.
  database.exec(
    `INSERT INTO project_node_approvers (node_id, user_id, created_at)
     SELECT n.id, n.binding_approver_id, datetime('now')
     FROM project_nodes n
     WHERE n.binding_approver_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM project_node_approvers a
         WHERE a.node_id = n.id AND a.user_id = n.binding_approver_id
       )`,
  );
  const flowColumns = database
    .prepare("PRAGMA table_info(binding_flows)")
    .all() as Array<{ name: string }>;
  if (!flowColumns.some((column) => column.name === "web_url")) {
    database.exec("ALTER TABLE binding_flows ADD COLUMN web_url TEXT");
  }
  if (!flowColumns.some((column) => column.name === "reviewed_by")) {
    database.exec("ALTER TABLE binding_flows ADD COLUMN reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL");
  }
  const barcodeColumns = database
    .prepare("PRAGMA table_info(binding_flow_barcodes)")
    .all() as Array<{ name: string }>;
  for (const [name, sql] of [
    ["validation_result", "ALTER TABLE binding_flow_barcodes ADD COLUMN validation_result TEXT NOT NULL DEFAULT 'UNREVIEWED' CHECK (validation_result IN ('UNREVIEWED','PASS','FAIL'))"],
    ["validated_at", "ALTER TABLE binding_flow_barcodes ADD COLUMN validated_at TEXT"],
    ["validated_by", "ALTER TABLE binding_flow_barcodes ADD COLUMN validated_by INTEGER REFERENCES users(id) ON DELETE SET NULL"],
    ["failure_reason", "ALTER TABLE binding_flow_barcodes ADD COLUMN failure_reason TEXT"],
    ["failure_reason_at", "ALTER TABLE binding_flow_barcodes ADD COLUMN failure_reason_at TEXT"],
    ["failure_reason_by", "ALTER TABLE binding_flow_barcodes ADD COLUMN failure_reason_by INTEGER REFERENCES users(id) ON DELETE SET NULL"],
  ]) {
    if (!barcodeColumns.some((column) => column.name === name)) database.exec(sql);
  }
  const legacyBarcodeFlows = database.prepare(
    `SELECT f.id, f.device_barcode AS barcodes, f.submitted_at AS submittedAt
     FROM binding_flows f
     WHERE trim(f.device_barcode) <> ''
       AND NOT EXISTS (SELECT 1 FROM binding_flow_barcodes b WHERE b.flow_id = f.id)`,
  ).all() as Array<{ id: number; barcodes: string; submittedAt: string }>;
  const insertBarcode = database.prepare("INSERT INTO binding_flow_barcodes (flow_id, barcode, created_at) VALUES (?, ?, ?)");
  for (const flow of legacyBarcodeFlows) {
    const barcodes = new Set(flow.barcodes.split(/[\n,，;；]+/).map((barcode) => barcode.trim()).filter(Boolean));
    for (const barcode of barcodes) insertBarcode.run(flow.id, barcode, flow.submittedAt);
  }
  const requestColumns = database
    .prepare("PRAGMA table_info(version_transfer_requests)")
    .all() as Array<{ name: string }>;
  if (!requestColumns.some((column) => column.name === "release_mode")) {
    database.exec(`ALTER TABLE version_transfer_requests ADD COLUMN ${TRANSFER_REQUEST_RELEASE_MODE_COLUMN_SQL}`);
  }
  if (!requestColumns.some((column) => column.name === "risk_conclusion")) {
    database.exec(`ALTER TABLE version_transfer_requests ADD COLUMN ${TRANSFER_REQUEST_RISK_CONCLUSION_COLUMN_SQL}`);
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
    ["build_url", `ALTER TABLE package_versions ADD COLUMN ${PACKAGE_VERSION_BUILD_URL_COLUMN_SQL}`],
    ["binding_mode", "ALTER TABLE package_versions ADD COLUMN binding_mode TEXT NOT NULL DEFAULT 'PENDING'"],
    ["binding_reason", "ALTER TABLE package_versions ADD COLUMN binding_reason TEXT"],
    ["binding_decided_at", "ALTER TABLE package_versions ADD COLUMN binding_decided_at TEXT"],
    ["binding_decided_by", "ALTER TABLE package_versions ADD COLUMN binding_decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL"],
    ["void_kind", "ALTER TABLE package_versions ADD COLUMN void_kind TEXT"],
    ["voided_by", "ALTER TABLE package_versions ADD COLUMN voided_by INTEGER REFERENCES users(id) ON DELETE SET NULL"],
    ["trial_review_minutes", "ALTER TABLE package_versions ADD COLUMN trial_review_minutes TEXT"],
    ["formal_review_minutes", "ALTER TABLE package_versions ADD COLUMN formal_review_minutes TEXT"],
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
    ["confirmed_at", "ALTER TABLE binding_requirements ADD COLUMN confirmed_at TEXT"],
    ["confirmed_by", "ALTER TABLE binding_requirements ADD COLUMN confirmed_by INTEGER REFERENCES users(id) ON DELETE SET NULL"],
    ["barcode_revision", "ALTER TABLE binding_requirements ADD COLUMN barcode_revision INTEGER NOT NULL DEFAULT 0 CHECK (barcode_revision >= 0)"],
    ["barcode_confirmation", "ALTER TABLE binding_requirements ADD COLUMN barcode_confirmation INTEGER NOT NULL DEFAULT 0 CHECK (barcode_confirmation IN (0,1))"],
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
  const migratedAt = new Date().toISOString();
  const legacyBindingPasses = database.prepare(
    `UPDATE binding_requirements SET status = 'PENDING', updated_at = ?
     WHERE status = 'PASSED' AND confirmed_at IS NULL
       AND package_version_id IN (SELECT id FROM package_versions WHERE status IN ('TRIAL','PENDING_FORMAL'))
     RETURNING package_version_id AS versionId`,
  ).all(migratedAt) as { versionId: number }[];
  for (const versionId of new Set(legacyBindingPasses.map((requirement) => requirement.versionId))) {
    refreshTrialReadiness(database, versionId, migratedAt);
  }
  database.exec(
    `INSERT OR IGNORE INTO project_pms (project_id, user_id, created_at)
     SELECT id, pm_user_id, datetime('now') FROM projects WHERE pm_user_id IS NOT NULL`,
  );
  database.exec(
    `INSERT OR IGNORE INTO project_software_managers (project_id, user_id, created_at)
     SELECT id, software_manager_id, datetime('now') FROM projects WHERE software_manager_id IS NOT NULL`,
  );
  // Normalize in place so account IDs and all business and session references stay valid.
  database.exec("UPDATE users SET role = 'MEMBER' WHERE role NOT IN ('ADMIN', 'MEMBER')");
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
  return withImmediateTransaction(db, fn);
}
