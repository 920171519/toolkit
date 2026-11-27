import type { DatabaseSync } from "node:sqlite";
import { OPEN_BINDING_RELEASE_STATUSES_SQL } from "./binding-availability";

type ActiveBindingSummary = {
  total: number;
  settled: number;
  cancelled: number;
};

type ActiveReleaseRequest = { id: number; projectId: number; projectName: string; status: string };

const activeReleaseRequest = "r.trial_released_at IS NOT NULL AND pr.status != 'ARCHIVED'";
const activeIntegrationBatch = `FROM batch_items bi
  JOIN integration_batches b ON b.id = bi.batch_id
  JOIN projects p ON p.id = b.project_id
  WHERE bi.transfer_request_id IS NOT NULL
    AND b.status IN ('DRAFT','IN_TEST') AND p.status != 'ARCHIVED'`;

export const ACTIVE_INTEGRATION_BATCH_COUNT_SQL = `(
  SELECT COUNT(DISTINCT b.id) ${activeIntegrationBatch} AND bi.package_version_id = pv.id
)`;

export function getActiveReleaseRequests(database: DatabaseSync, versionId: number) {
  return database.prepare(
    `SELECT r.id, r.project_id AS projectId, pr.name AS projectName, r.status
     FROM version_transfer_requests r JOIN projects pr ON pr.id = r.project_id
     WHERE r.package_version_id = ? AND ${activeReleaseRequest}
     ORDER BY pr.sort_order`,
  ).all(versionId) as ActiveReleaseRequest[];
}

function getActiveBindingSummary(database: DatabaseSync, versionId: number): ActiveBindingSummary {
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

function hasActiveIntegrationBatch(database: DatabaseSync, versionId: number) {
  return Boolean(database.prepare(`SELECT b.id ${activeIntegrationBatch} AND bi.package_version_id = ? LIMIT 1`).get(versionId));
}

function getActiveIntegrationBatches(database: DatabaseSync, versionId: number) {
  return database.prepare(
    `SELECT DISTINCT b.id, b.code, b.status, p.id AS projectId, p.name AS projectName
     ${activeIntegrationBatch} AND bi.package_version_id = ? ORDER BY p.sort_order, b.id`,
  ).all(versionId) as Array<{ id: number; code: string; status: string; projectId: number; projectName: string }>;
}

export function getPendingBindingFlowCounts(database: DatabaseSync, versionIds: number[]): Map<number, number> {
  if (versionIds.length === 0) return new Map();
  const rows = database.prepare(
    `SELECT f.package_version_id AS versionId, COUNT(*) AS count FROM binding_flows f
     JOIN projects pr ON pr.id = f.project_id
     WHERE f.package_version_id IN (SELECT value FROM json_each(?))
       AND f.status = 'PENDING' AND pr.status != 'ARCHIVED'
     GROUP BY f.package_version_id`,
  ).all(JSON.stringify(versionIds)) as Array<{ versionId: number; count: number }>;
  return new Map(rows.map(({ versionId, count }) => [versionId, count]));
}

function areFormalBindingsReady(binding: ActiveBindingSummary, mode: string) {
  if (mode === "PENDING") return false;
  return mode === "SKIPPED"
    ? binding.cancelled === binding.total
    : binding.total > 0 && binding.settled === binding.total;
}

function formalReleaseBlocker(
  version: { status: string; bindingMode: string },
  requests: ActiveReleaseRequest[],
  activeBatchCount: number,
  pendingFlowCount: number,
  bindingsReady: boolean,
): string | null {
  if (version.status !== "PENDING_FORMAL") return "该版本尚未完成绑定验证或已转正。";
  if (activeBatchCount > 0) return "该软件包仍有关联转测批次待发起或在测，不能转正。";
  if (pendingFlowCount > 0) return "仍有绑定电子流待审批。请在绑定验证中完成审批或撤销后再转正。";
  const unfinished = requests.find((request) => request.status !== "PENDING_FORMAL");
  if (unfinished) return `${unfinished.projectName} 尚未完成全部项目绑定验证，不能转正。`;
  if (bindingsReady) return null;
  return version.bindingMode === "SKIPPED"
    ? "该版本已标记无需绑定，但仍存在未关闭的绑定要求。"
    : "该软件包仍有未处理的节点绑定要求，不能转正。";
}

export function getFormalReleaseCheck(
  database: DatabaseSync,
  version: { id: number; status: string; bindingMode: string },
  requests: ActiveReleaseRequest[],
) {
  const binding = getActiveBindingSummary(database, version.id);
  const batches = getActiveIntegrationBatches(database, version.id);
  const pendingFlowCount = getPendingBindingFlowCounts(database, [version.id]).get(version.id) ?? 0;
  const bindingsReady = areFormalBindingsReady(binding, version.bindingMode);
  return {
    binding, batches, pendingFlowCount, bindingsReady,
    blocker: formalReleaseBlocker(version, requests, batches.length, pendingFlowCount, bindingsReady),
  };
}

export function refreshTrialReadiness(database: DatabaseSync, versionId: number, timestamp: string) {
  const version = database.prepare(
    `SELECT pv.status, pv.binding_mode FROM package_versions pv
     WHERE pv.id = ? AND pv.status IN ${OPEN_BINDING_RELEASE_STATUSES_SQL}
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
     WHERE package_version_id = ? AND status IN ${OPEN_BINDING_RELEASE_STATUSES_SQL} AND status != ?
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
     WHERE pv.status IN ${OPEN_BINDING_RELEASE_STATUSES_SQL} AND r.trial_released_at IS NOT NULL AND ${scope}`,
  ).all(...(projectId === undefined ? [] : [projectId])) as Array<{ id: number }>;
  for (const version of versions) {
    refreshTrialReadiness(database, version.id, timestamp);
  }
}
