import type { DatabaseSync } from "node:sqlite";
import { createAuditLogWriter } from "./audit-log";
import { findMissingTrialTransferRequests, TRIAL_PENDING_VERSION_STATUSES_SQL, type TransferScope } from "./transfer-requests";

export function insertTransferRequest(
  database: DatabaseSync,
  versionId: number,
  projectId: number,
  timestamp: string,
) {
  return database.prepare(
    `INSERT INTO version_transfer_requests
       (package_version_id, project_id, status, submitted_at, updated_at)
     VALUES (?, ?, 'PENDING', ?, ?)
     ON CONFLICT(package_version_id, project_id) DO NOTHING`,
  ).run(versionId, projectId, timestamp, timestamp).changes > 0;
}

export function recordBatchRequestIntegration(
  database: DatabaseSync,
  requestId: number,
  nextStatus: "PENDING" | "IN_TEST" | "PASSED" | "FAILED" | "BLOCKED",
  timestamp: string,
) {
  const previousStatus = nextStatus === "IN_TEST" ? "PENDING" : "IN_TEST";
  database.prepare(
    `UPDATE version_transfer_requests
     SET status = CASE WHEN status = ? THEN ? ELSE status END,
         integration_status = CASE WHEN integration_status IS NOT NULL THEN ? END,
         updated_at = ?
     WHERE id = ? ${nextStatus === "PENDING" ? "AND status != 'VOID'" : ""}`,
  ).run(previousStatus, nextStatus, nextStatus, timestamp, requestId);
}

export function refreshVersionAggregate(database: DatabaseSync, versionId: number, timestamp?: string) {
  const version = database.prepare(
    `SELECT status, package_id AS packageId, status IN ${TRIAL_PENDING_VERSION_STATUSES_SQL} AS beforeTrial
     FROM package_versions WHERE id = ?`,
  ).get(versionId) as { status: string; packageId: number; beforeTrial: number } | undefined;
  if (!version || version.status === "VOID") return;

  const requests = database.prepare(
    `SELECT r.status FROM version_transfer_requests r
     JOIN projects p ON p.id = r.project_id
     WHERE r.package_version_id = ? AND (
       ? = 0 OR (p.status != 'ARCHIVED' AND EXISTS (
         SELECT 1 FROM package_usages u WHERE u.package_id = ? AND u.project_id = r.project_id
       ))
     )`,
  ).all(versionId, version.beforeTrial, version.packageId) as Array<{ status: string }>;
  if (requests.length === 0) return;
  const allFormal = requests.every((request) => request.status === "FORMAL");
  if (version.status === "FORMAL" && !allFormal) return;

  let status = "PENDING_TRANSFER";
  if (allFormal) status = "FORMAL";
  else if (requests.some((request) => request.status === "TRIAL")) status = "TRIAL";
  else if (requests.some((request) => request.status === "PENDING_FORMAL")) status = "PENDING_FORMAL";
  else if (requests.some((request) => request.status === "IN_TEST")) status = "IN_TEST";
  else if (requests.every((request) => ["PASSED", "FAILED", "BLOCKED", "VOID", "CANCELLED"].includes(request.status))) status = "PENDING_TRIAL";
  else if (requests.some((request) => ["PASSED", "FAILED", "BLOCKED"].includes(request.status))) status = "IN_TEST";

  // A scope-only recalculation should not change the order of unaffected versions.
  if (timestamp === undefined && version.status === status) return;
  database.prepare("UPDATE package_versions SET status = ?, updated_at = ? WHERE id = ?")
    .run(status, timestamp ?? new Date().toISOString(), versionId);
}

export function refreshScopedPendingVersions(database: DatabaseSync, scope: { packageId: number } | { projectId: number }) {
  const [condition, id] = "packageId" in scope
    ? ["v.package_id = ?", scope.packageId]
    : ["EXISTS (SELECT 1 FROM package_usages u WHERE u.package_id = v.package_id AND u.project_id = ?)", scope.projectId];
  const versions = database.prepare(
    `SELECT v.id FROM package_versions v
     WHERE v.status IN ${TRIAL_PENDING_VERSION_STATUSES_SQL} AND ${condition}`,
  ).all(id) as Array<{ id: number }>;
  for (const version of versions) refreshVersionAggregate(database, version.id);
}

// Call within the transaction that changes the scope or applies a reviewed backfill.
export function backfillTrialTransferRequests(database: DatabaseSync, actorId: number | null, scope: TransferScope = {}) {
  const timestamp = new Date().toISOString();
  const inserted = findMissingTrialTransferRequests(database, scope).filter((request) =>
    insertTransferRequest(database, request.versionId, request.projectId, timestamp));
  if (!inserted.length) return inserted;

  const audit = createAuditLogWriter(database);
  for (const request of inserted) {
    audit(
      actorId,
      "BACKFILL_TRANSFER_REQUEST",
      "PACKAGE_VERSION",
      request.versionId,
      `补派 ${request.packageCode} ${request.version} 转测至 ${request.projectName}（${request.projectCode}）`,
      timestamp,
    );
  }
  for (const versionId of new Set(inserted.map((request) => request.versionId))) {
    refreshVersionAggregate(database, versionId, timestamp);
  }
  return inserted;
}
