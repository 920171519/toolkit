import "server-only";

import { all, one } from "./db";
import { PENDING_BATCH_REQUEST_SQL, transferRequestProjectScope } from "./transfer-requests";

export type PendingTransferItem = {
  requestId: number;
  versionId: number;
  packageId: number;
  packageName: string;
  packageCode: string;
  version: string;
  changeSummary: string;
  archiveUrl: string;
  submittedByName: string | null;
  submittedById: number | null;
  versionStatus: string;
  submittedAt: string;
  ownerName: string | null;
  canInclude: number;
  packageActive: number;
  draftBatchId: number | null;
  draftBatchProjectId: number | null;
  draftBatchCode: string | null;
};

export type PendingTransferGroup = {
  projectId: number;
  projectName: string;
  projectCode: string;
  items: PendingTransferItem[];
};

const pendingTransferFrom = `FROM version_transfer_requests r
  JOIN package_versions pv ON pv.id = r.package_version_id
  JOIN packages p ON p.id = pv.package_id
  JOIN projects pr ON pr.id = r.project_id
  LEFT JOIN integration_batches draft ON draft.id = (
    SELECT b.id FROM batch_items bi JOIN integration_batches b ON b.id = bi.batch_id
    WHERE bi.transfer_request_id = r.id AND b.status = 'DRAFT' ORDER BY b.id LIMIT 1
  )`;
const activePendingTransfer = `pv.status != 'VOID' AND ${PENDING_BATCH_REQUEST_SQL} AND pr.status != 'ARCHIVED'`;
const unreservedTransferInUse = `draft.id IS NULL AND EXISTS (
  SELECT 1 FROM package_usages u WHERE u.package_id = p.id AND u.project_id = r.project_id
)`;
const pendingTransferVersionOrder = "pv.submitted_at DESC, pv.id DESC";

export function getProjectPendingTransferCount(projectId: number): number {
  return one<{ total: number }>(
    `SELECT COUNT(*) AS total ${pendingTransferFrom}
     WHERE r.project_id = ? AND ${activePendingTransfer} AND ${unreservedTransferInUse}`,
    projectId,
  )?.total ?? 0;
}

export function getPendingTransferGroups(
  projectIds: number[] | null = null,
  guidanceProjectIds: number[] | null = [],
): PendingTransferGroup[] {
  if (projectIds?.length === 0) return [];
  const scope = transferRequestProjectScope(projectIds);
  const guideScope = guidanceProjectIds === null ? "1" : guidanceProjectIds.length
    ? `pr.id IN (${guidanceProjectIds.map(() => "?").join(", ")})` : "0";
  const rows = all<PendingTransferItem & { projectId: number; projectName: string; projectCode: string }>(
    `SELECT r.id AS requestId, pv.id AS versionId, p.id AS packageId, p.name AS packageName,
            p.code AS packageCode, pv.version, pv.change_summary AS changeSummary, pv.archive_url AS archiveUrl,
            su.name AS submittedByName, pv.submitted_by AS submittedById, pv.status AS versionStatus,
            pv.submitted_at AS submittedAt, o.name AS ownerName,
            p.is_active = 1 AND ${unreservedTransferInUse} AS canInclude,
            p.is_active AS packageActive, draft.id AS draftBatchId, draft.project_id AS draftBatchProjectId, draft.code AS draftBatchCode,
            pr.id AS projectId, pr.name AS projectName, pr.code AS projectCode
     ${pendingTransferFrom}
     LEFT JOIN users su ON su.id = pv.submitted_by
     LEFT JOIN users o ON o.id = p.owner_id
     WHERE ${activePendingTransfer}
       ${scope.predicate}
       AND ((${unreservedTransferInUse}) OR ${guideScope})
     ORDER BY pr.sort_order, pr.id, ${pendingTransferVersionOrder}`,
    ...scope.params, ...(guidanceProjectIds ?? []),
  );
  const groups = new Map<number, PendingTransferGroup>();
  for (const row of rows) {
    let group = groups.get(row.projectId);
    if (!group) {
      group = { projectId: row.projectId, projectName: row.projectName, projectCode: row.projectCode, items: [] };
      groups.set(row.projectId, group);
    }
    group.items.push(row);
  }
  return [...groups.values()];
}

export function getPendingTransferPreviews(projectIds: number[] | null) {
  if (projectIds?.length === 0) return [];
  const scope = transferRequestProjectScope(projectIds);
  const rows = all<Pick<PendingTransferItem, "packageName" | "packageCode" | "version"> & {
    projectId: number; projectName: string; total: number;
  }>(
    `SELECT projectId, projectName, packageName, packageCode, version, total FROM (
       SELECT pr.id AS projectId, pr.name AS projectName, pr.sort_order AS projectOrder,
              p.name AS packageName, p.code AS packageCode, pv.version,
              COUNT(*) OVER (PARTITION BY pr.id) AS total,
              ROW_NUMBER() OVER (PARTITION BY pr.id ORDER BY ${pendingTransferVersionOrder}) AS position
       ${pendingTransferFrom}
       WHERE ${activePendingTransfer} ${scope.predicate} AND ${unreservedTransferInUse}
     ) WHERE position <= 4
     ORDER BY projectOrder, projectId, position`,
    ...scope.params,
  );
  return [...Map.groupBy(rows, (row) => row.projectId).values()].map((versions) => {
    const { projectId, projectName, total } = versions[0];
    return { projectId, projectName, total, versions };
  });
}
