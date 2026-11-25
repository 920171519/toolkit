import type { DatabaseSync } from "node:sqlite";

type ActiveBindingSummary = {
  total: number;
  settled: number;
  cancelled: number;
};

const openTrialStatuses = "('TRIAL','PENDING_FORMAL')";
const activeReleaseRequest = "r.trial_released_at IS NOT NULL AND pr.status != 'ARCHIVED'";
const activeIntegrationBatch = `FROM batch_items bi
  JOIN integration_batches b ON b.id = bi.batch_id
  JOIN projects p ON p.id = b.project_id
  WHERE bi.package_version_id = ? AND bi.transfer_request_id IS NOT NULL
    AND b.status IN ('DRAFT','IN_TEST') AND p.status != 'ARCHIVED'`;

export function getActiveReleaseRequests(database: DatabaseSync, versionId: number) {
  return database.prepare(
    `SELECT r.id, r.project_id AS projectId, pr.name AS projectName, r.status
     FROM version_transfer_requests r JOIN projects pr ON pr.id = r.project_id
     WHERE r.package_version_id = ? AND ${activeReleaseRequest}
     ORDER BY pr.sort_order`,
  ).all(versionId) as Array<{ id: number; projectId: number; projectName: string; status: string }>;
}

export function getActiveBindingSummary(database: DatabaseSync, versionId: number): ActiveBindingSummary {
  return database.prepare(
    `SELECT COUNT(*) AS total,
            COUNT(CASE WHEN (br.status = 'PASSED' AND br.confirmed_at IS NOT NULL)
                         OR (br.status = 'CANCELLED' AND br.waived_at IS NOT NULL) THEN 1 END) AS settled,
            COUNT(CASE WHEN br.status = 'CANCELLED' THEN 1 END) AS cancelled
     FROM version_transfer_requests r
     JOIN projects pr ON pr.id = r.project_id
     JOIN binding_requirements br ON br.request_id = r.id
     WHERE r.package_version_id = ? AND ${activeReleaseRequest}`,
  ).get(versionId) as ActiveBindingSummary;
}

export function hasActiveIntegrationBatch(database: DatabaseSync, versionId: number) {
  return Boolean(database.prepare(`SELECT b.id ${activeIntegrationBatch} LIMIT 1`).get(versionId));
}

export function getActiveIntegrationBatches(database: DatabaseSync, versionId: number) {
  return database.prepare(
    `SELECT DISTINCT b.id, b.code, b.status, p.id AS projectId, p.name AS projectName
     ${activeIntegrationBatch} ORDER BY p.sort_order, b.id`,
  ).all(versionId) as Array<{ id: number; code: string; status: string; projectId: number; projectName: string }>;
}

export function areFormalBindingsReady(binding: ActiveBindingSummary, mode: string) {
  return mode === "SKIPPED"
    ? binding.cancelled === binding.total
    : binding.total > 0 && binding.settled === binding.total;
}

export function refreshTrialReadiness(database: DatabaseSync, versionId: number, timestamp: string) {
  const version = database.prepare(
    `SELECT pv.status, pv.binding_mode FROM package_versions pv
     WHERE pv.id = ? AND pv.status IN ${openTrialStatuses}
       AND EXISTS (
         SELECT 1 FROM version_transfer_requests r JOIN projects pr ON pr.id = r.project_id
         WHERE r.package_version_id = pv.id AND ${activeReleaseRequest}
       )`,
  ).get(versionId) as { status: string; binding_mode: string } | undefined;
  if (!version) return false;

  const binding = getActiveBindingSummary(database, versionId);
  const ready = (version.binding_mode === "PUSHED" || version.binding_mode === "SKIPPED")
    && areFormalBindingsReady(binding, version.binding_mode);
  const nextStatus = ready && !hasActiveIntegrationBatch(database, versionId) ? "PENDING_FORMAL" : "TRIAL";
  if (version.status !== nextStatus) {
    database.prepare("UPDATE package_versions SET status = ?, updated_at = ? WHERE id = ?")
      .run(nextStatus, timestamp, versionId);
  }
  database.prepare(
    `UPDATE version_transfer_requests SET status = ?, updated_at = ?
     WHERE package_version_id = ? AND status IN ${openTrialStatuses} AND status != ?
       AND trial_released_at IS NOT NULL
       AND project_id IN (SELECT id FROM projects WHERE status != 'ARCHIVED')`,
  ).run(nextStatus, timestamp, versionId, nextStatus);
  return nextStatus === "PENDING_FORMAL" && version.status !== nextStatus;
}

// Pass no project to repair older releases left waiting on an archived project.
export function refreshProjectTrialReadiness(database: DatabaseSync, timestamp: string, projectId?: number) {
  const scope = projectId === undefined ? "pr.status = 'ARCHIVED'" : "pr.id = ?";
  const versions = database.prepare(
    `SELECT DISTINCT r.package_version_id AS id
     FROM version_transfer_requests r
     JOIN projects pr ON pr.id = r.project_id
     JOIN package_versions pv ON pv.id = r.package_version_id
     WHERE pv.status IN ${openTrialStatuses} AND r.trial_released_at IS NOT NULL AND ${scope}`,
  ).all(...(projectId === undefined ? [] : [projectId])) as Array<{ id: number }>;
  for (const version of versions) {
    refreshTrialReadiness(database, version.id, timestamp);
  }
}
