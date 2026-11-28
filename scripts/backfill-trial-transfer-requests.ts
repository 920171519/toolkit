import { realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { closeDatabaseAfterError, withImmediateTransaction } from "../lib/sqlite-lifecycle";
import { backfillTrialTransferRequests } from "../lib/transfer-request-writes";
import { findMissingTrialTransferRequests } from "../lib/transfer-requests";

const SQLITE_READONLY = 8;

function assertReadOnlyPreviewSupport() {
  let probe: DatabaseSync | undefined;
  try {
    // Some Node.js versions ignore the option. Verify it before opening the target.
    probe = new DatabaseSync(":memory:", { readOnly: true });
    probe.exec("CREATE TABLE read_only_probe (id INTEGER)");
  } catch (error) {
    if (probe && error instanceof Error && "errcode" in error && error.errcode === SQLITE_READONLY) return;
  } finally {
    probe?.close();
  }
  throw new Error("当前 Node.js 运行时无法确认 SQLite 只读模式。请升级到支持该模式的版本后重试预览。");
}

function main() {
  const [databaseFlag, path, applyFlag, ...extra] = process.argv.slice(2);
  if (databaseFlag !== "--database" || !path || path.startsWith("--") || (applyFlag && applyFlag !== "--apply") || extra.length) {
    throw new Error("用法：pnpm exec tsx scripts/backfill-trial-transfer-requests.ts --database <现有数据库路径> [--apply]");
  }

  const filename = realpathSync(resolve(path));
  if (!statSync(filename).isFile()) throw new Error("请选择已有的数据库文件。");
  const apply = applyFlag === "--apply";
  if (!apply) assertReadOnlyPreviewSupport();
  const database = new DatabaseSync(filename, { readOnly: !apply });
  try {
    database.exec("PRAGMA busy_timeout = 5000");
    console.log(`数据库：${filename}`);
    const requests = apply
      ? withImmediateTransaction(database, () => backfillTrialTransferRequests(database, null))
      : findMissingTrialTransferRequests(database);
    if (requests.length) {
      console.table(requests.map((request) => ({
        软件包编码: request.packageCode,
        版本: request.version,
        项目: request.projectName,
        项目代号: request.projectCode,
      })));
    }
    console.log(apply ? `已补派 ${requests.length} 条转测申请。` : `预览：待补派 ${requests.length} 条转测申请。`);
  } catch (error) {
    closeDatabaseAfterError(database, error);
  }
  database.close();
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
