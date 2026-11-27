import { resolve } from "node:path";

export const REPORT_STORAGE_KEY_PREFIX = "data/uploads/reports";

export function getDatabasePath(): string {
  return resolve(/* turbopackIgnore: true */ process.env.DATABASE_PATH || "data/toolkit.db");
}

export function resolveReportStoragePath(defaultPath: string, relativePath: string): string {
  const configuredRoot = process.env.TOOLKIT_REPORTS_PATH;
  return configuredRoot ? resolve(/* turbopackIgnore: true */ configuredRoot, relativePath) : defaultPath;
}

export function shouldSeedDemoData(): boolean {
  return process.env.TOOLKIT_SKIP_SEED !== "1";
}
