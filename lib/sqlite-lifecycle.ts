import type { DatabaseSync } from "node:sqlite";

const sqliteBusy = 5;
const busyTimeoutMs = 5_000;
const walRetryIntervalMs = 25;

export function configureDatabaseConnection(database: DatabaseSync) {
  // Setting WAL can return BUSY without invoking SQLite's busy handler.
  // Give just this setup statement one bounded wait budget.
  database.exec("PRAGMA busy_timeout = 0;");
  database.exec("PRAGMA foreign_keys = ON;");
  const deadline = performance.now() + busyTimeoutMs;
  const waitState = new Int32Array(new SharedArrayBuffer(4));

  for (;;) {
    try {
      database.exec("PRAGMA journal_mode = WAL;");
      break;
    } catch (error) {
      if (!(error instanceof Error) || !("errcode" in error) || error.errcode !== sqliteBusy) throw error;

      const delay = Math.min(walRetryIntervalMs, deadline - performance.now());
      if (delay > 0) Atomics.wait(waitState, 0, 0, delay);
      if (performance.now() >= deadline) throw error;
    }
  }

  database.exec(`PRAGMA busy_timeout = ${busyTimeoutMs};`);
}

// The callback finishes its work before the synchronous commit.
export type SynchronousTransactionCallback<T> = () => T & Exclude<T, { then: (...args: never[]) => unknown }>;

export function withImmediateTransaction<T>(database: DatabaseSync, fn: SynchronousTransactionCallback<T>): T {
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
