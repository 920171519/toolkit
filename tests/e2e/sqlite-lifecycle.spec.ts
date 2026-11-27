import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";
import { closeDatabaseAfterError, withImmediateTransaction } from "../../lib/sqlite-lifecycle";

test("SQLite 写事务保留返回值，开启失败时保留已有事务", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec("CREATE TABLE fixture (value INTEGER);");
    const result = { recorded: true };
    expect(withImmediateTransaction(database, () => {
      database.exec("INSERT INTO fixture VALUES (1);");
      expect(() => withImmediateTransaction(database, () => database.exec("INSERT INTO fixture VALUES (2);"))).toThrow();
      return result;
    })).toBe(result);
    expect(withImmediateTransaction(database, () => database.prepare("SELECT value FROM fixture").all()))
      .toEqual([{ value: 1 }]);
  } finally {
    database.close();
  }
});

test("SQLite 自动回滚或关闭连接失败后保留原始错误", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(`
      CREATE TABLE fixture (value INTEGER);
      CREATE TRIGGER fail_fixture BEFORE INSERT ON fixture WHEN NEW.value = 2
      BEGIN SELECT RAISE(ROLLBACK, 'fixture write refused'); END;
    `);
    expect(() => withImmediateTransaction(database, () => {
      database.exec("INSERT INTO fixture VALUES (1), (2);");
    })).toThrow("fixture write refused");
    expect(withImmediateTransaction(database, () => database.prepare("SELECT value FROM fixture").all()))
      .toEqual([]);
  } finally {
    database.close();
  }

  const original = new Error("fixture failed before close");
  assert.throws(() => closeDatabaseAfterError(database, original), (error) => error === original);
});
