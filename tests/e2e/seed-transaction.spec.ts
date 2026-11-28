import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";
import { SCHEMA_SQL } from "../../lib/schema";
import { seedDatabase } from "../../lib/seed";

test("演示数据在取得写锁后重新核对初始化状态", ({}, testInfo) => {
  const path = testInfo.outputPath("concurrent-demo-seed.db");
  const database = new DatabaseSync(path);
  const peer = new DatabaseSync(path);
  try {
    database.exec(SCHEMA_SQL);
    let peerSeeded = false;
    let users = 0;
    const connecting = new Proxy(database, {
      get(target, key) {
        if (key === "exec") {
          return (sql: string) => {
            if (!peerSeeded && /^BEGIN(?:\s|$)/i.test(sql)) {
              peerSeeded = true;
              seedDatabase(peer);
              const count = peer.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
              users = count.count;
            }
            target.exec(sql);
          };
        }
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    seedDatabase(connecting);
    expect(peerSeeded).toBe(true);
    expect(users).toBeGreaterThan(0);
    expect(database.prepare("SELECT COUNT(*) AS count FROM users").get()).toEqual({ count: users });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    peer.close();
    database.close();
  }
});

test("演示数据自动回滚后保留原始写入错误", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(SCHEMA_SQL);
    database.exec("CREATE TRIGGER reject_seed BEFORE INSERT ON package_versions BEGIN SELECT RAISE(ROLLBACK, '演示数据写入校验失败'); END");
    expect(() => seedDatabase(database)).toThrow("演示数据写入校验失败");
    expect(database.prepare("SELECT COUNT(*) AS count FROM users").get()).toEqual({ count: 0 });
  } finally {
    database.close();
  }
});
