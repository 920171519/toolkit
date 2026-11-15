import path from "node:path";
import { existsSync, rmSync } from "node:fs";

const databasePath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(process.cwd(), "data", "toolkit.db");

if (!databasePath.endsWith(".db") && !databasePath.endsWith(".sqlite")) {
  throw new Error(`拒绝删除可疑路径：${databasePath}`);
}

const targets = [databasePath, `${databasePath}-shm`, `${databasePath}-wal`];
for (const target of targets) {
  if (existsSync(target)) {
    rmSync(target);
    console.log(`removed ${target}`);
  } else {
    console.log(`skipped (not found) ${target}`);
  }
}
console.log("数据库已重置。下一次访问会重新创建表并写入演示数据。");
