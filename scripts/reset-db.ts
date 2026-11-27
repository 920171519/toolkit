import { existsSync, rmSync } from "node:fs";
import { getDatabasePath } from "../lib/runtime-config";

const databasePath = getDatabasePath();

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
console.log("数据库已重置。服务重新打开数据库时，会按启动配置创建表并决定是否写入演示数据。");
