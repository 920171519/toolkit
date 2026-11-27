import type { FullConfig } from "@playwright/test";

export default function configureFixtureStorage({ webServer }: FullConfig) {
  const databasePath = webServer?.env?.DATABASE_PATH;
  const reportsPath = webServer?.env?.TOOLKIT_REPORTS_PATH;
  if (!databasePath || !reportsPath) throw new Error("E2E 测试服务需要配置独立的数据库和验证报告目录。");

  // Workers inherit the same paths as the running server, even after a worker restarts.
  process.env.TOOLKIT_QA_DB = databasePath;
  process.env.TOOLKIT_REPORTS_PATH = reportsPath;
}
