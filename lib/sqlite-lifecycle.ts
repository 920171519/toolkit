import type { DatabaseSync } from "node:sqlite";

export function withImmediateTransaction<T>(database: DatabaseSync, fn: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // SQLite may have rolled back already. Preserve the original failure.
    }
    throw error;
  }
}

export function closeDatabaseAfterError(database: DatabaseSync, error: unknown): never {
  try {
    database.close();
  } catch {
    // Preserve the failure that required closing the connection.
  }
  throw error;
}
