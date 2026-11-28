import type { DatabaseSync } from "node:sqlite";
import { packageIdentity } from "./package-identity";

export const TRIAL_PENDING_VERSION_STATUSES_SQL = "('PENDING_TRANSFER','IN_TEST','PENDING_TRIAL')";
export const TRIAL_USABLE_REQUEST_STATUSES_SQL = "('PENDING','IN_TEST','PASSED','FAILED','BLOCKED')";

export type LinkedBatchEvidence = {
  batchId: number | null;
  batchCode: string | null;
  batchProjectId: number | null;
  batchStatus: string | null;
  batchConclusion: string | null;
};

const linkedTransferBatchColumns = {
  batchId: "b.id",
  batchCode: "b.code",
  batchProjectId: "b.project_id",
  batchStatus: "b.status",
  batchConclusion: "b.conclusion",
} satisfies Record<keyof LinkedBatchEvidence, string>;

export const LINKED_TRANSFER_BATCH_COLUMNS_SQL = Object.entries(linkedTransferBatchColumns)
  .map(([key, column]) => `${column} AS ${key}`).join(", ");

// The latest batch item is selected for transfer request r. Its batch uses alias b.
export const LATEST_TRANSFER_BATCH_JOIN_SQL = `LEFT JOIN integration_batches b ON b.id = (
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

export type TransferScope = { packageId?: number; projectId?: number };

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
