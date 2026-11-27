import { statSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function openE2eDatabase(options: { readOnly?: boolean } = {}): DatabaseSync {
  const configuredPath = process.env.TOOLKIT_QA_DB;
  if (!configuredPath) throw new Error("未设置 E2E 数据库路径 TOOLKIT_QA_DB。");
  const databasePath = resolve(configuredPath);
  if (!statSync(databasePath, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`E2E 服务尚未创建数据库：${databasePath}`);
  }
  return new DatabaseSync(databasePath, options);
}

export function getE2eReportsDirectory(): string {
  const directory = process.env.TOOLKIT_REPORTS_PATH;
  if (!directory) throw new Error("未设置 E2E 验证报告路径 TOOLKIT_REPORTS_PATH。");
  return resolve(directory);
}
