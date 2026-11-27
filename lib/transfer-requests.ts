import type { DatabaseSync } from "node:sqlite";
import { createAuditLogWriter } from "./audit-log";
import { packageIdentity } from "./package-identity";

export const TRIAL_PENDING_VERSION_STATUSES_SQL = "('PENDING_TRANSFER','IN_TEST','PENDING_TRIAL')";
export const TRIAL_USABLE_REQUEST_STATUSES_SQL = "('PENDING','IN_TEST','PASSED','FAILED','BLOCKED')";

// These SQL fragments read the current transfer request under alias r.
export const LATEST_TRANSFER_REQUEST_BATCH_ID_SQL = `(
  SELECT bi.batch_id FROM batch_items bi WHERE bi.transfer_request_id = r.id ORDER BY bi.id DESC LIMIT 1
)`;

// Pending requests and parallel risk trials use their separate integration status.
// In other states the request status, including terminal states, takes precedence.
export const EFFECTIVE_INTEGRATION_STATUS_SQL = `CASE WHEN r.status IN ('PENDING','TRIAL','PENDING_FORMAL')
  THEN COALESCE(r.integration_status, r.status) ELSE r.status END`;
export const PENDING_BATCH_REQUEST_SQL = `(${EFFECTIVE_INTEGRATION_STATUS_SQL}) = 'PENDING'`;

export function transferRequestProjectScope(projectIds: number[] | null) {
  return projectIds === null ? { predicate: "", params: [] } : {
    predicate: "AND r.project_id IN (SELECT value FROM json_each(?))",
    params: [JSON.stringify(projectIds)],
  };
}

const openBatchReservation = `SELECT 1 FROM batch_items bi
  JOIN integration_batches b ON b.id = bi.batch_id
  WHERE bi.transfer_request_id = r.id AND b.status IN ('DRAFT','IN_TEST')`;

export const OPEN_BATCH_RESERVATION_SQL = `EXISTS (${openBatchReservation})`;
export const OTHER_OPEN_BATCH_RESERVATION_SQL = `EXISTS (${openBatchReservation} AND b.id != ?)`;

type PreviousBatchVersion = { versionId: number; version: string; canCarry: number };

export function getPreviousBatchVersions(
  database: DatabaseSync,
  projectId: number,
  packageIds: readonly number[],
): Map<number, PreviousBatchVersion> {
  if (packageIds.length === 0) return new Map();
  const rows = database.prepare(
    `SELECT packageId, versionId, version, canCarry FROM (
       SELECT bi.package_id AS packageId, bi.package_version_id AS versionId, bi.version,
              pv.status != 'VOID' AND COALESCE(
                (${EFFECTIVE_INTEGRATION_STATUS_SQL}) NOT IN ('VOID','CANCELLED','PENDING'), 1
              ) AS canCarry,
              ROW_NUMBER() OVER (
                PARTITION BY bi.package_id
                ORDER BY COALESCE(b.completed_at, b.sent_at) DESC, bi.id DESC
              ) AS position
       FROM batch_items bi JOIN integration_batches b ON b.id = bi.batch_id
       JOIN package_versions pv ON pv.id = bi.package_version_id
       LEFT JOIN version_transfer_requests r ON r.package_version_id = pv.id AND r.project_id = b.project_id
       WHERE b.project_id = ? AND b.status IN ('IN_TEST','COMPLETED')
         AND bi.package_id IN (SELECT value FROM json_each(?))
     ) WHERE position = 1`,
  ).all(projectId, JSON.stringify(packageIds)) as Array<PreviousBatchVersion & { packageId: number }>;
  return new Map(rows.map(({ packageId, ...version }) => [packageId, version]));
}

export function getActiveTransferProjects(database: DatabaseSync, packageId: number) {
  return database.prepare(
    `SELECT DISTINCT p.id, p.name
     FROM package_usages u JOIN projects p ON p.id = u.project_id
     WHERE u.package_id = ? AND p.status != 'ARCHIVED'
     ORDER BY p.sort_order, p.id`,
  ).all(packageId) as Array<{ id: number; name: string }>;
}

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

type TransferScope = { packageId?: number; projectId?: number };

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

type MissingTransferRequest = {
  packageCode: string;
  versionId: number;
  version: string;
  projectId: number;
  projectCode: string;
  projectName: string;
};

export function findMissingTrialTransferRequests(database: DatabaseSync, scope: TransferScope = {}) {
  const filters: string[] = [];
  const parameters: number[] = [];
  if (scope.packageId !== undefined) {
    filters.push("pv.package_id = ?");
    parameters.push(scope.packageId);
  }
  if (scope.projectId !== undefined) {
    filters.push("u.project_id = ?");
    parameters.push(scope.projectId);
  }

  const rows = database.prepare(
    `SELECT DISTINCT p.name, p.code, pv.id AS versionId, pv.version,
            pr.id AS projectId, pr.code AS projectCode, pr.name AS projectName
     FROM package_versions pv
     JOIN packages p ON p.id = pv.package_id AND p.is_active = 1
     JOIN package_usages u ON u.package_id = pv.package_id
     JOIN projects pr ON pr.id = u.project_id AND pr.status != 'ARCHIVED'
     WHERE pv.status IN ${TRIAL_PENDING_VERSION_STATUSES_SQL}
       AND pv.trial_released_at IS NULL AND pv.formal_released_at IS NULL
       ${filters.map((predicate) => "AND " + predicate).join(" ")}
       AND EXISTS (
         SELECT 1 FROM version_transfer_requests r
         WHERE r.package_version_id = pv.id
           AND r.status IN ${TRIAL_USABLE_REQUEST_STATUSES_SQL}
       )
       AND NOT EXISTS (
         SELECT 1 FROM version_transfer_requests r
         WHERE r.package_version_id = pv.id AND r.project_id = pr.id
       )
     ORDER BY p.code, pv.id, pr.sort_order, pr.id`,
  ).all(...parameters) as Array<Omit<MissingTransferRequest, "packageCode"> & { name: string; code: string }>;
  return rows.map(({ name, code, ...request }): MissingTransferRequest => ({
    ...request,
    packageCode: packageIdentity({ name, code }).code,
  }));
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
