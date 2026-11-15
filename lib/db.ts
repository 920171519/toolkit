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
  database.exec(SCHEMA_SQL);
  migrateSchema(database);
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