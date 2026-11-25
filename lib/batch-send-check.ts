import "server-only";

import { all } from "./db";

type DraftItem = {
  packageName: string;
  version: string;
  transferRequestId: number | null;
  requestStatus: string | null;
  versionId: number;
  versionStatus: string;
  conflictingBatchId: number | null;
  conflictingBatchCode: string | null;
};

type DraftBlocker = { message: string; batchId?: number };

export function getBatchSendCheck(batchId: number) {
  const items = all<DraftItem>(
    `SELECT p.name AS packageName, bi.version, bi.transfer_request_id AS transferRequestId,
            CASE WHEN r.status IN ('PENDING','TRIAL','PENDING_FORMAL')
              THEN COALESCE(r.integration_status, r.status) ELSE r.status END AS requestStatus,
            bi.package_version_id AS versionId, pv.status AS versionStatus,
            conflict.id AS conflictingBatchId, conflict.code AS conflictingBatchCode
     FROM batch_items bi JOIN packages p ON p.id = bi.package_id
     JOIN package_versions pv ON pv.id = bi.package_version_id
     LEFT JOIN version_transfer_requests r ON r.id = bi.transfer_request_id
     LEFT JOIN integration_batches conflict ON conflict.id = (
       SELECT b.id FROM batch_items other JOIN integration_batches b ON b.id = other.batch_id
       WHERE other.transfer_request_id = bi.transfer_request_id AND b.status = 'IN_TEST' ORDER BY b.id LIMIT 1
     )
     WHERE bi.batch_id = ?
     ORDER BY bi.id`,
    batchId,
  );
  const changes = items.filter((item) => item.transferRequestId !== null);
  const blockers: DraftBlocker[] = items.filter((item) => item.versionStatus === "VOID").map((item) => ({
    message: `${item.packageName} ${item.version} 已作废，请在配套中更换或移除该版本。`,
  }));
  if (!changes.length) blockers.push({ message: "批次中没有待转测的新版本，至少纳入一个待转测版本。" });
  for (const item of changes) {
    if (item.versionStatus === "VOID") continue;
    if (item.conflictingBatchId !== null) blockers.push({
      message: `${item.packageName} ${item.version} 已在批次 ${item.conflictingBatchCode} 集成测试中。`,
      batchId: item.conflictingBatchId,
    });
    else if (item.requestStatus !== "PENDING") blockers.push({
      message: `${item.packageName} ${item.version} 的转测申请已不在待测试状态，请更换本轮配套。`,
    });
  }
  return { changes, blockers };
}
