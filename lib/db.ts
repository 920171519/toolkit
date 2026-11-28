import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseBindingBarcodeText } from "./binding-barcode-results";
import { prepareBindingBarcodeWriter } from "./binding-barcode-writer";
import { getDatabasePath, shouldSeedDemoData } from "./runtime-config";
import { ADDITIVE_COLUMNS, SCHEMA_SQL, type AdditiveTable } from "./schema";
import { seedDatabase } from "./seed";
import { closeDatabaseAfterError, configureDatabaseConnection, withImmediateTransaction, type SynchronousTransactionCallback } from "./sqlite-lifecycle";
import { refreshProjectTrialReadiness, refreshTrialReadiness } from "./trial-readiness";

type SqlValue = string | number | bigint | null | Uint8Array;

const globalForDb = globalThis as unknown as { __toolkitDb?: DatabaseSync };
let localDb: DatabaseSync | undefined;

function createDatabase(): DatabaseSync {
  const databasePath = getDatabasePath();
  mkdirSync(dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  try {
    configureDatabaseConnection(database);
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

function getColumnNames(database: DatabaseSync, table: AdditiveTable) {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(columns.map(({ name }) => name));
}

// The caller can use the original column names to gate data backfills.
function addMissingColumns(database: DatabaseSync, table: AdditiveTable) {
  const originalColumns = getColumnNames(database, table);
  for (const [column, definition] of Object.entries(ADDITIVE_COLUMNS[table])) {
    if (!originalColumns.has(column)) {
      database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
  return originalColumns;
}

function migrateSchema(database: DatabaseSync) {
  const projectColumns = getColumnNames(database, "projects");
  if (!projectColumns.has("software_manager_id")) {
    database.exec(`ALTER TABLE projects ADD COLUMN software_manager_id ${ADDITIVE_COLUMNS.projects.software_manager_id}`);
  }
  database.exec("CREATE INDEX IF NOT EXISTS idx_projects_manager ON projects(software_manager_id);");
  if (!projectColumns.has("stage")) {
    database.exec(`ALTER TABLE projects ADD COLUMN stage ${ADDITIVE_COLUMNS.projects.stage}`);
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
  addMissingColumns(database, "binding_flows");
  addMissingColumns(database, "binding_flow_barcodes");
  const legacyBarcodeFlows = database.prepare(
    `SELECT f.id, f.device_barcode AS barcodes, f.submitted_at AS submittedAt
     FROM binding_flows f
     WHERE trim(f.device_barcode) <> ''
       AND NOT EXISTS (SELECT 1 FROM binding_flow_barcodes b WHERE b.flow_id = f.id)`,
  ).all() as Array<{ id: number; barcodes: string; submittedAt: string }>;
  const writeBarcodes = prepareBindingBarcodeWriter(database);
  for (const flow of legacyBarcodeFlows) {
    const barcodes = new Set(parseBindingBarcodeText(flow.barcodes));
    writeBarcodes(flow.id, barcodes, flow.submittedAt);
  }
  addMissingColumns(database, "version_transfer_requests");
  addMissingColumns(database, "batch_items");
  addMissingColumns(database, "packages");
  const versionColumns = addMissingColumns(database, "package_versions");
  const requirementColumns = addMissingColumns(database, "binding_requirements");
  database.exec("UPDATE package_versions SET build_url = archive_url WHERE build_url IS NULL");
  if (!requirementColumns.has("pushed_at")) {
    database.exec(
      `UPDATE binding_requirements SET pushed_at = created_at
       WHERE request_id IN (
         SELECT id FROM version_transfer_requests WHERE status IN ('TRIAL','PENDING_FORMAL','FORMAL','VOID')
       )`,
    );
  }
  if (!versionColumns.has("binding_mode")) {
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

export function transaction<T>(fn: SynchronousTransactionCallback<T>): T {
  return withImmediateTransaction(db, fn);
}
