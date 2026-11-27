import { all, db, one } from "./db";
import { canManageProjectWorkflowForProject, canReadBatchEvidence, getBatchEvidenceReadScope, getIntegrationManagedProjectIds, getManagedProjectScope, getNarrowVersionRequestIds, getProjectWorkflowProjectIds, getReadableBatchEvidenceIds, getReadableLinkedBatchEvidence, getReadableVersionIds, type LinkedBatchEvidence } from "./access";
import { OPEN_BINDING_RELEASE_STATUSES_SQL, OPEN_BINDING_REQUIREMENT_STATUSES_SQL } from "./binding-availability";
import {
  ACTIVE_BINDING_FLOW_STATUSES_SQL,
  bindingBarcodeEvidenceKey,
  bindingBarcodeProgress,
  summarizeBindingBarcodes,
  type BindingBarcodeFact,
  type BindingBarcodeResult,
} from "./binding-barcode-results";
import type { BatchConclusion, BatchStatus } from "./constants";
import type { readIntegrationHistory } from "./integration-history";
import { PARALLEL_RISK_TRIAL_ITEM_SQL } from "./integration-conclusion";
import { getPageWindow } from "./list-pagination";
import { getReadNotificationKeys } from "./notification-reads";
import { packageCodeSql, packageIdentity } from "./package-identity";
import type { SessionUser } from "./types";
import { STANDALONE_VERSION_HISTORY_IN_PROJECT_SQL } from "./version-scope";
import type { TraceListState } from "./version-trace-list";
import { workflowHref } from "./workflow-links";
import { getTrialReadyVersions } from "./trial-eligibility";
import { ACTIVE_INTEGRATION_BATCH_COUNT_SQL, getPendingBindingFlowCounts } from "./trial-readiness";
import { EFFECTIVE_INTEGRATION_STATUS_SQL, getPreviousBatchVersions, LATEST_TRANSFER_REQUEST_BATCH_ID_SQL, PENDING_BATCH_REQUEST_SQL } from "./transfer-requests";

export function getNextBatchCode(): string {
  const batch = one<{ highest: number | null }>(
    `SELECT MAX(CAST(SUBSTR(code, 2) AS INTEGER)) AS highest FROM integration_batches
     WHERE UPPER(code) GLOB 'B[0-9]*' AND SUBSTR(code, 2) NOT GLOB '*[^0-9]*'`,
  );
  return `B${String(Math.max(120, batch?.highest ?? 0) + 1).padStart(3, "0")}`;
}

function pendingRequestProjectScope(projectIds: number[] | null) {
  return projectIds === null ? { predicate: "", params: [] } : {
    predicate: "AND r.project_id IN (SELECT value FROM json_each(?))",
    params: [JSON.stringify(projectIds)],
  };
}

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

export function getPendingTransferGroups(
  projectIds: number[] | null = null,
  guidanceProjectIds: number[] | null = [],
): PendingTransferGroup[] {
  if (projectIds?.length === 0) return [];
  const scope = pendingRequestProjectScope(projectIds);
  const guideScope = guidanceProjectIds === null ? "1" : guidanceProjectIds.length
    ? `pr.id IN (${guidanceProjectIds.map(() => "?").join(", ")})` : "0";
  const rows = all<PendingTransferItem & { projectId: number; projectName: string; projectCode: string }>(
    `SELECT r.id AS requestId, pv.id AS versionId, p.id AS packageId, p.name AS packageName,
            p.code AS packageCode, pv.version, pv.change_summary AS changeSummary, pv.archive_url AS archiveUrl,
            su.name AS submittedByName, pv.submitted_by AS submittedById, pv.status AS versionStatus,
            pv.submitted_at AS submittedAt, o.name AS ownerName,
            draft.id IS NULL AND p.is_active = 1 AND EXISTS (
              SELECT 1 FROM package_usages usage WHERE usage.package_id = p.id AND usage.project_id = r.project_id
            ) AS canInclude,
            p.is_active AS packageActive, draft.id AS draftBatchId, draft.project_id AS draftBatchProjectId, draft.code AS draftBatchCode,
            pr.id AS projectId, pr.name AS projectName, pr.code AS projectCode
     FROM version_transfer_requests r
     JOIN package_versions pv ON pv.id = r.package_version_id
     JOIN packages p ON p.id = pv.package_id
     JOIN projects pr ON pr.id = r.project_id
     LEFT JOIN users su ON su.id = pv.submitted_by
     LEFT JOIN users o ON o.id = p.owner_id
     LEFT JOIN integration_batches draft ON draft.id = (
       SELECT b.id FROM batch_items bi JOIN integration_batches b ON b.id = bi.batch_id
       WHERE bi.transfer_request_id = r.id AND b.status = 'DRAFT' ORDER BY b.id LIMIT 1
     )
     WHERE pv.status != 'VOID' AND ${PENDING_BATCH_REQUEST_SQL}
       AND pr.status != 'ARCHIVED'
       ${scope.predicate}
       AND ((draft.id IS NULL AND EXISTS (
         SELECT 1 FROM package_usages u WHERE u.package_id = pv.package_id AND u.project_id = r.project_id
       )) OR ${guideScope})
     ORDER BY pr.sort_order, pr.id, pv.submitted_at DESC, pv.id DESC`,
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

export type BatchCandidatePackage = {
  packageId: number;
  packageName: string;
  packageCode: string;
  ownerName: string | null;
  areaName: string | null;
  versionId: number;
  version: string;
  versionStatus: string;
  versions: Array<{ id: number; version: string; status: string; requestStatus: string | null }>;
  defaultVersionId: number;
  carryVersionId: number | null;
  requestId: number | null;
  formalVersion: string | null;
  currentTrialVersions: string[];
  previousTestVersion: string | null;
  changedVsPrevious: boolean;
  changeSummary: string;
  archiveUrl: string;
};

export function getBatchCandidatesForProject(projectId: number, editingBatchId = 0): BatchCandidatePackage[] {
  const packages = all<{
    packageId: number;
    packageName: string;
    packageCode: string;
    ownerName: string | null;
    areaName: string | null;
  }>(
    `SELECT DISTINCT p.id AS packageId, p.name AS packageName, p.code AS packageCode,
            u.name AS ownerName, a.name AS areaName
     FROM packages p
     JOIN package_usages usage ON usage.package_id = p.id
     LEFT JOIN users u ON u.id = p.owner_id
     LEFT JOIN areas a ON a.id = p.area_id
     WHERE usage.project_id = ? AND p.is_active = 1
     ORDER BY ${packageCodeSql("p.name", "p.code")} COLLATE NOCASE, p.id`,
    projectId,
  );
  if (packages.length === 0) return [];
  type CandidateVersion = {
    packageId: number;
    id: number;
    version: string;
    status: string;
    archiveUrl: string;
    changeSummary: string;
  };
  const versionRows = all<CandidateVersion>(
    `SELECT pv.package_id AS packageId, pv.id, pv.version, pv.status,
            pv.archive_url AS archiveUrl, pv.change_summary AS changeSummary
     FROM package_versions pv
     JOIN packages p ON p.id = pv.package_id AND p.is_active = 1
     WHERE EXISTS (
       SELECT 1 FROM package_usages usage WHERE usage.project_id = ? AND usage.package_id = p.id
     )
     ORDER BY pv.package_id, pv.submitted_at DESC, pv.id DESC`,
    projectId,
  );
  const versionsByPackage = new Map<number, CandidateVersion[]>();
  for (const version of versionRows) {
    const group = versionsByPackage.get(version.packageId);
    if (group) group.push(version);
    else versionsByPackage.set(version.packageId, [version]);
  }
  const previousByPackage = getPreviousBatchVersions(db, projectId, packages.map(({ packageId }) => packageId));
  const projectRequests = all<{ requestId: number; versionId: number; status: string; reserved: number }>(
    `SELECT r.id AS requestId, r.package_version_id AS versionId,
            ${EFFECTIVE_INTEGRATION_STATUS_SQL} AS status,
            EXISTS (
              SELECT 1 FROM batch_items bi JOIN integration_batches b ON b.id = bi.batch_id
              WHERE bi.transfer_request_id = r.id AND b.id != ?
                AND (b.status = 'DRAFT' OR (b.status = 'IN_TEST' AND COALESCE(r.integration_status, r.status) = 'PENDING'))
            ) AS reserved
     FROM version_transfer_requests r WHERE r.project_id = ?`,
    editingBatchId, projectId,
  );
  const requestByVersion = new Map(projectRequests.map((request) => [request.versionId, request]));
  return packages.map((pkg) => {
    const versionRows = versionsByPackage.get(pkg.packageId) ?? [];
    const versions = versionRows.filter((version) => !requestByVersion.get(version.id)?.reserved).map((version) => ({
      id: version.id,
      version: version.version,
      status: version.status,
      requestStatus: requestByVersion.get(version.id)?.status ?? null,
    }));
    const pending = versions.find((version) => version.requestStatus === "PENDING") ?? null;
    const formal = versions.find((version) => version.status === "FORMAL") ?? null;
    const trialVersions = versions.filter((version) => version.status === "TRIAL" || version.status === "PENDING_FORMAL");
    const previous = previousByPackage.get(pkg.packageId);
    const previousVersion = previous ? versions.find((version) => version.id === previous.versionId) ?? null : null;
    const previousSafe = previous?.canCarry ? previousVersion : null;
    const firstSafe = versions.find((version) => version.status !== "VOID" && version.requestStatus !== "VOID") ?? null;
    const defaultVersion = pending ?? previousSafe ?? formal ?? firstSafe ?? versions[0] ?? null;
    if (!defaultVersion) return null;
    const selectedRow = versionRows.find((version) => version.id === defaultVersion.id);
    const selectedRequest = requestByVersion.get(defaultVersion.id);
    return {
      ...pkg,
      versionId: defaultVersion.id,
      version: defaultVersion.version,
      versionStatus: selectedRequest?.status ?? defaultVersion.status,
      versions,
      defaultVersionId: defaultVersion.id,
      carryVersionId: previousSafe?.id ?? null,
      requestId: selectedRequest?.status === "PENDING" ? selectedRequest.requestId : null,
      formalVersion: formal?.version ?? null,
      currentTrialVersions: trialVersions.map((version) => version.version),
      previousTestVersion: previous?.version ?? null,
      changedVsPrevious: previous?.version !== defaultVersion.version,
      changeSummary: selectedRow?.changeSummary ?? "",
      archiveUrl: selectedRow?.archiveUrl ?? "",
    };
  }).filter((item): item is BatchCandidatePackage => item !== null);
}

export type BatchSummaryRow = {
  id: number;
  code: string;
  title: string;
  status: string;
  projectId: number;
  projectName: string;
  projectCode: string;
  projectStatus: string;
  softwareManagerId: number | null;
  conclusion: string | null;
  issueAttribution: string | null;
  createdAt: string;
  sentAt: string | null;
  completedAt: string | null;
  terminatedAt: string | null;
  terminateReason: string | null;
  testSummary: string | null;
  testReportUrl: string | null;
  testReportName: string | null;
  testReportFileId: number | null;
  createdByName: string | null;
  itemCount: number;
  changedCount: number;
};

const batchItemCount = "(SELECT COUNT(*) FROM batch_items bi WHERE bi.batch_id = b.id)";
const batchChangedCount = "(SELECT COUNT(*) FROM batch_items bi WHERE bi.batch_id = b.id AND bi.is_changed = 1)";
const batchSummaryColumns = `b.id, b.code, b.title, b.status, b.project_id AS projectId,
            pr.name AS projectName, pr.code AS projectCode, pr.status AS projectStatus,
            pr.software_manager_id AS softwareManagerId, b.conclusion,
            b.issue_attribution AS issueAttribution, b.created_at AS createdAt,
            b.sent_at AS sentAt, b.completed_at AS completedAt, b.terminated_at AS terminatedAt,
            b.terminate_reason AS terminateReason, b.test_summary AS testSummary,
            b.test_report_url AS testReportUrl, b.test_report_name AS testReportName,
            b.test_report_file_id AS testReportFileId, c.name AS createdByName,
            ${batchItemCount} AS itemCount, ${batchChangedCount} AS changedCount`;
const batchSummaryFrom = `FROM integration_batches b
     JOIN projects pr ON pr.id = b.project_id
     LEFT JOIN users c ON c.id = b.created_by`;
const batchSummaryOrder = "ORDER BY COALESCE(b.sent_at, b.created_at) DESC, b.id DESC";

type BatchFilters = { statuses?: BatchStatus[]; query?: string; offset?: number; activeProjectsOnly?: boolean };

function batchFilterConditions(projectIds: number[] | null, filters: BatchFilters) {
  const predicates: string[] = [];
  const values: (number | string)[] = [];
  if (projectIds) {
    predicates.push(`b.project_id IN (${projectIds.map(() => "?").join(",")})`);
    values.push(...projectIds);
  }
  if (filters.statuses?.length) {
    predicates.push(`b.status IN (${filters.statuses.map(() => "?").join(",")})`);
    values.push(...filters.statuses);
  }
  if (filters.activeProjectsOnly) predicates.push("pr.status != 'ARCHIVED'");
  for (const term of filters.query?.trim().toLowerCase().match(/\S+/g) ?? []) {
    predicates.push("INSTR(LOWER(b.code || ' ' || b.title || ' ' || pr.name || ' ' || pr.code), ?) > 0");
    values.push(term);
  }
  return { predicates, values };
}

function batchWhere(predicates: string[]) {
  return predicates.length > 0 ? `WHERE ${predicates.join(" AND ")}` : "";
}

export function getBatches(limit = 80, projectIds: number[] | null = null, filters: BatchFilters = {}): BatchSummaryRow[] {
  if (projectIds?.length === 0) return [];
  const { predicates, values } = batchFilterConditions(projectIds, filters);
  return all<BatchSummaryRow>(
    `SELECT ${batchSummaryColumns} ${batchSummaryFrom}
     ${batchWhere(predicates)} ${batchSummaryOrder} LIMIT ? OFFSET ?`,
    ...values, limit, filters.offset ?? 0,
  );
}

export function getBatchCount(projectIds: number[] | null, filters: BatchFilters): number {
  if (projectIds?.length === 0) return 0;
  const { predicates, values } = batchFilterConditions(projectIds, filters);
  return one<{ count: number }>(
    `SELECT COUNT(*) AS count FROM integration_batches b JOIN projects pr ON pr.id = b.project_id ${batchWhere(predicates)}`,
    ...values,
  )?.count ?? 0;
}

export function getProjectBatchCounts(projectId: number, includeDrafts: boolean) {
  return one<{ draft: number; inTest: number }>(
    `SELECT COUNT(*) FILTER (WHERE status = 'DRAFT') AS draft,
            COUNT(*) FILTER (WHERE status = 'IN_TEST') AS inTest
     FROM integration_batches WHERE project_id = ? AND (status = 'IN_TEST' OR (? = 1 AND status = 'DRAFT'))`,
    projectId,
    Number(includeDrafts),
  ) ?? { draft: 0, inTest: 0 };
}

export function getRecentProjectBatches(projectId: number, limit: number, includeDrafts: boolean) {
  return all<{ id: number; code: string; title: string; status: BatchStatus; conclusion: BatchConclusion | null; activityAt: string }>(
    `SELECT id, code, title, status, conclusion, COALESCE(completed_at, terminated_at, sent_at, created_at) AS activityAt
     FROM integration_batches
     WHERE project_id = ? AND (? = 1 OR status != 'DRAFT')
     ORDER BY activityAt DESC, id DESC LIMIT ?`,
    projectId,
    Number(includeDrafts),
    limit,
  );
}

export function getIntegrationHistoryPage(
  state: ReturnType<typeof readIntegrationHistory>,
  projectIds: number[] | null,
  { statuses, query }: Pick<BatchFilters, "statuses" | "query"> = {},
) {
  if (projectIds?.length === 0) return { rows: [], total: 0, page: 1, pages: 1 };
  const { filters, pageSize } = state;
  const { predicates: conditions, values } = batchFilterConditions(projectIds, {
    statuses: statuses?.length ? statuses : ["COMPLETED", "TERMINATED"],
    query,
  });

  for (const [key, column] of [["batch", "b.code"], ["title", "b.title"]]) {
    const value = filters[`f_${key}`];
    if (!value) continue;
    conditions.push(filters[`f_${key}_mode`] === "exact"
      ? `${column} = ? COLLATE NOCASE`
      : `instr(lower(${column}), lower(?)) > 0`);
    values.push(value);
  }

  for (const [key, column] of [
    ["project", "b.project_id"], ["status", "b.status"], ["conclusion", "COALESCE(b.conclusion, 'NONE')"],
  ]) {
    const selection = filters[`f_${key}`]?.split(",");
    if (!selection) continue;
    conditions.push(`${column} IN (${selection.map(() => "?").join(", ")})`);
    values.push(...selection);
  }

  for (const [key, expression] of [["items", batchItemCount], ["changed", batchChangedCount]]) {
    const min = filters[`f_${key}_min`];
    const max = filters[`f_${key}_max`];
    if (min !== undefined) {
      conditions.push(`${expression} >= ?`);
      values.push(Number(min));
    }
    if (max !== undefined) {
      conditions.push(`${expression} <= ?`);
      values.push(Number(max));
    }
  }

  const localDate = "date(COALESCE(b.completed_at, b.terminated_at, b.sent_at, b.created_at), '+8 hours')";
  if (filters.f_date_min) {
    conditions.push(`${localDate} >= ?`);
    values.push(filters.f_date_min);
  }
  if (filters.f_date_max) {
    conditions.push(`${localDate} <= ?`);
    values.push(filters.f_date_max);
  }

  const where = conditions.join(" AND ");
  const total = one<{ total: number }>(`SELECT COUNT(*) AS total ${batchSummaryFrom} WHERE ${where}`, ...values)?.total ?? 0;
  const { current: page, pages, offset } = getPageWindow(total, pageSize, state.page);
  const rows = total === 0 ? [] : all<BatchSummaryRow>(
    `SELECT ${batchSummaryColumns} ${batchSummaryFrom}
     WHERE ${where} ${batchSummaryOrder} LIMIT ? OFFSET ?`,
    ...values, pageSize, offset,
  );
  return { rows, total, page, pages };
}

export type BatchItemRow = {
  id: number;
  packageId: number;
  packageName: string;
  packageCode: string;
  versionId: number;
  version: string;
  archiveUrl: string;
  changeSummary: string;
  isChanged: boolean;
  transferRequestId: number | null;
  requestStatus: string | null;
  versionStatus: string;
  activeBatchId: number | null;
  formalVersion: string | null;
  trialVersions: string | null;
  previousTestVersion: string | null;
  changedVsPrevious: boolean;
  ownerName: string | null;
  parallelRiskTrial: boolean;
  issueAffected: boolean;
};

export type BatchProgressNote = {
  id: number;
  content: string;
  createdAt: string;
  authorName: string | null;
};

export type BatchDetailRow = { batch: BatchSummaryRow; items: BatchItemRow[]; progressNotes: BatchProgressNote[] };

export function getIntegrationConclusionContactNames(projectId: number): string[] {
  return all<{ name: string }>(
    `SELECT DISTINCT u.name FROM users u
     WHERE u.is_active = 1 AND (
       EXISTS (SELECT 1 FROM area_project_leads l JOIN areas a ON a.id = l.area_id AND a.is_integration = 1
         WHERE l.project_id = ? AND l.user_id = u.id)
       OR EXISTS (SELECT 1 FROM area_leaders l JOIN areas a ON a.id = l.area_id AND a.is_integration = 1
         WHERE l.user_id = u.id)
     ) ORDER BY u.name`,
    projectId,
  ).map(({ name }) => name);
}

export function getReadableTestReport(user: SessionUser, reportId: number) {
  const report = one<{ originalName: string; storedPath: string; mimeType: string; uploadedBy: number | null }>(
    `SELECT original_name AS originalName, stored_path AS storedPath, mime_type AS mimeType, uploaded_by AS uploadedBy
     FROM report_files WHERE id = ?`,
    reportId,
  );
  if (!report) return null;
  const { uploadedBy, ...file } = report;
  if (user.role === "ADMIN") return file;

  const batches = all<{ projectId: number | null; status: string }>(
    `SELECT project_id AS projectId, status FROM integration_batches
     WHERE test_report_file_id = ? OR test_report_url = ?`,
    reportId,
    `/api/reports/${reportId}`,
  );
  const readable = batches.length === 0 ? uploadedBy === user.id
    : batches.some(({ projectId, status }) => projectId !== null && canReadBatchEvidence(user, projectId, status));
  return readable ? file : null;
}

export function getBatchDetail(user: SessionUser, batchId: number, projectId?: number): BatchDetailRow | null {
  const readableBatchIds = getReadableBatchEvidenceIds(user, [batchId]);
  if (readableBatchIds !== null && !readableBatchIds.has(batchId)) return null;
  const batch = one<BatchSummaryRow>(
    `SELECT ${batchSummaryColumns} ${batchSummaryFrom} WHERE b.id = ? AND (? IS NULL OR b.project_id = ?)`,
    batchId, projectId ?? null, projectId ?? null,
  );
  if (!batch) return null;
  const items = all<Omit<BatchItemRow, "isChanged" | "changedVsPrevious" | "parallelRiskTrial" | "issueAffected"> & {
    isChanged: number;
    changedVsPrevious: number;
    parallelRiskTrial: number | null;
    issueAffected: number;
  }>(
    `SELECT bi.id, p.id AS packageId, p.name AS packageName, p.code AS packageCode,
            bi.package_version_id AS versionId, bi.version, bi.archive_url AS archiveUrl,
            bi.change_summary AS changeSummary, bi.is_changed AS isChanged,
            bi.transfer_request_id AS transferRequestId,
            CASE WHEN pv.status = 'VOID' THEN 'VOID' ELSE COALESCE(r.integration_status, r.status) END AS requestStatus,
            pv.status AS versionStatus,
            (SELECT active_batch.id FROM batch_items current_item
             JOIN integration_batches active_batch ON active_batch.id = current_item.batch_id
             WHERE current_item.transfer_request_id = r.id AND active_batch.project_id = r.project_id
               AND active_batch.status = 'IN_TEST'
             ORDER BY active_batch.id DESC LIMIT 1) AS activeBatchId,
            bi.formal_version AS formalVersion, bi.trial_versions AS trialVersions,
            bi.previous_test_version AS previousTestVersion, bi.changed_vs_previous AS changedVsPrevious,
            u.name AS ownerName, bi.issue_affected AS issueAffected,
            ${PARALLEL_RISK_TRIAL_ITEM_SQL} AS parallelRiskTrial
     FROM batch_items bi
     JOIN packages p ON p.id = bi.package_id
     JOIN package_versions pv ON pv.id = bi.package_version_id
     LEFT JOIN version_transfer_requests r ON r.id = bi.transfer_request_id
     LEFT JOIN users u ON u.id = p.owner_id
     WHERE bi.batch_id = ?
     ORDER BY bi.is_changed DESC, ${packageCodeSql("p.name", "p.code")} COLLATE NOCASE, p.id`,
    batchId,
  ).map((item) => ({
    ...item,
    isChanged: Boolean(item.isChanged),
    changedVsPrevious: Boolean(item.changedVsPrevious),
    parallelRiskTrial: Boolean(item.parallelRiskTrial),
    issueAffected: Boolean(item.issueAffected),
  }));
  const progressNotes = all<BatchProgressNote>(
    `SELECT n.id, n.content, n.created_at AS createdAt, u.name AS authorName
     FROM batch_progress_notes n LEFT JOIN users u ON u.id = n.author_id
     WHERE n.batch_id = ? ORDER BY n.created_at DESC, n.id DESC`,
    batchId,
  );
  return { batch, items, progressNotes };
}

export type TrialVersionRow = LinkedBatchEvidence & {
  requestId: number;
  versionId: number;
  projectId: number;
  projectName: string;
  projectCode: string;
  packageId: number;
  packageName: string;
  packageCode: string;
  version: string;
  trialFormNo: string | null;
  trialReleasedAt: string | null;
  submittedByName: string | null;
  archiveUrl: string;
  changeSummary: string;
  ownerName: string | null;
  softwareManagerName: string | null;
  softwareManagerId: number | null;
  releaseMode: "INTEGRATION" | "RISK";
  riskConclusion: string | null;
  bindingMode: "PENDING" | "PUSHED" | "SKIPPED";
  bindingReason: string | null;
  trialOverdueDays: number;
  isOverdue: number;
  requirementTotal: number;
  requirementPassed: number;
  requirementWaived: number;
  pendingFlowCount: number;
};

const trialQueueFrom = `FROM version_transfer_requests r
  JOIN package_versions pv ON pv.id = r.package_version_id
  JOIN projects pr ON pr.id = r.project_id`;

function trialQueueScope(projectIds: number[] | null, assignedRequestIds: number[]) {
  const activeTrial = "pr.status != 'ARCHIVED' AND pv.status = 'TRIAL' AND r.status = 'TRIAL'";
  if (projectIds === null) return { where: activeTrial, params: [] };
  return {
    where: `${activeTrial} AND (r.project_id IN (SELECT value FROM json_each(?)) OR r.id IN (SELECT value FROM json_each(?)))`,
    params: [JSON.stringify(projectIds), JSON.stringify(assignedRequestIds)],
  };
}

export function getTrialVersionCount(projectIds: number[] | null, assignedRequestIds: number[]): number {
  const { where, params } = trialQueueScope(projectIds, assignedRequestIds);
  return one<{ total: number }>(`SELECT COUNT(*) AS total ${trialQueueFrom} WHERE ${where}`, ...params)?.total ?? 0;
}

export function getTrialVersions(projectIds: number[] | null = null, assignedRequestIds: number[] = []): TrialVersionRow[] {
  const { where, params } = trialQueueScope(projectIds, assignedRequestIds);
  return all<TrialVersionRow>(
      `SELECT r.id AS requestId, pv.id AS versionId, pr.id AS projectId, pr.name AS projectName,
              pr.code AS projectCode, p.id AS packageId, p.name AS packageName, p.code AS packageCode,
              pv.version, r.trial_form_no AS trialFormNo, r.trial_released_at AS trialReleasedAt,
              su.name AS submittedByName, pv.archive_url AS archiveUrl, pv.change_summary AS changeSummary, o.name AS ownerName,
              sm.name AS softwareManagerName, pr.software_manager_id AS softwareManagerId,
              r.release_mode AS releaseMode, r.risk_conclusion AS riskConclusion,
              pv.binding_mode AS bindingMode, pv.binding_reason AS bindingReason,
              p.trial_overdue_days AS trialOverdueDays,
              CASE WHEN r.trial_released_at IS NOT NULL
                   AND datetime(r.trial_released_at, '+' || p.trial_overdue_days || ' days') < datetime('now')
                   THEN 1 ELSE 0 END AS isOverdue,
              b.id AS batchId, b.code AS batchCode, b.project_id AS batchProjectId, b.status AS batchStatus, b.conclusion AS batchConclusion,
              (SELECT COUNT(*) FROM binding_requirements br WHERE br.request_id = r.id) AS requirementTotal,
              (SELECT COUNT(*) FROM binding_requirements br WHERE br.request_id = r.id AND br.status = 'PASSED'
               AND br.confirmed_at IS NOT NULL) AS requirementPassed,
              (SELECT COUNT(*) FROM binding_requirements br WHERE br.request_id = r.id AND br.waived_at IS NOT NULL) AS requirementWaived,
              (SELECT COUNT(*) FROM binding_flows f WHERE f.requirement_id IN (SELECT id FROM binding_requirements WHERE request_id = r.id) AND f.status = 'PENDING') AS pendingFlowCount
       ${trialQueueFrom}
       JOIN packages p ON p.id = pv.package_id
       LEFT JOIN users su ON su.id = pv.submitted_by
       LEFT JOIN users o ON o.id = p.owner_id
       LEFT JOIN users sm ON sm.id = pr.software_manager_id
       LEFT JOIN integration_batches b ON b.id = ${LATEST_TRANSFER_REQUEST_BATCH_ID_SQL}
       WHERE ${where}
       ORDER BY r.trial_released_at DESC, r.id DESC`,
    ...params,
  ).map((version) => ({
    ...version,
    requirementTotal: Number(version.requirementTotal),
    requirementPassed: Number(version.requirementPassed),
    requirementWaived: Number(version.requirementWaived),
    pendingFlowCount: Number(version.pendingFlowCount),
  }));
}

export type BindingBarcodeRow = {
  id: number;
  barcode: string;
  result: BindingBarcodeResult;
  failureReason: string | null;
  validatedByName: string | null;
  validatedAt: string | null;
  failureReasonByName: string | null;
  failureReasonAt: string | null;
};

export type BindingFlowRow = {
  id: number;
  flowNo: string;
  requirementId: number;
  barcodes: string[];
  barcodeResults: BindingBarcodeRow[];
  webUrl: string | null;
  status: string;
  submittedByName: string | null;
  submittedById: number | null;
  submittedAt: string;
  approverName: string | null;
  approverId: number | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewComment: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
};

export function getPendingBindingFlowCount(versionId: number): number {
  return getPendingBindingFlowCounts(db, [versionId]).get(versionId) ?? 0;
}

export type BindingRequirementRow = {
  id: number;
  projectId: number;
  projectName: string;
  nodeId: number;
  nodeName: string;
  requiredCount: number;
  approvedCount: number;
  passedBarcodeCount: number;
  unreviewedApprovedCount: number;
  failedBarcodeCount: number;
  barcodeEvidenceKey: string;
  legacyConfirmation: boolean;
  submittedCount: number;
  pendingCount: number;
  status: string;
  bindingOwnerId: number | null;
  bindingOwnerName: string | null;
  approverId: number | null;
  approverName: string | null;
  pushedAt: string | null;
  pushedByName: string | null;
  decisionReason: string | null;
  waivedAt: string | null;
  waivedByName: string | null;
  confirmedAt: string | null;
  confirmedByName: string | null;
  approverOptions: Array<{ userId: number; userName: string; userEmployeeId: string; isActive: number }>;
  flows: BindingFlowRow[];
};

export type TrialDetail = {
  request: LinkedBatchEvidence & {
    id: number;
    projectId: number;
    projectName: string;
    projectCode: string;
    projectStatus: string;
    packageId: number;
    packageName: string;
    packageCode: string;
    packageOwnerId: number | null;
    versionId: number;
    version: string;
    status: string;
    versionStatus: string;
    integrationStatus: string | null;
    ongoingTestCount: number;
    changeSummary: string;
    archiveUrl: string;
    trialFormNo: string | null;
    trialReviewMinutes: string | null;
    trialReleasedAt: string | null;
    releaseMode: "INTEGRATION" | "RISK";
    riskConclusion: string | null;
    bindingMode: "PENDING" | "PUSHED" | "SKIPPED";
    bindingReason: string | null;
    trialOverdueDays: number;
    isOverdue: number;
    voidReason: string | null;
    voidKind: string | null;
    voidedAt: string | null;
    ownerName: string | null;
    softwareManagerName: string | null;
    softwareManagerId: number | null;
  };
  requirements: BindingRequirementRow[];
};

function bindingFlowCounts(flows: BindingFlowRow[]) {
  const facts = flows.flatMap(({ status, barcodeResults }) =>
    barcodeResults.map(({ barcode, result }) => ({ barcode, result, flowStatus: status })),
  );
  return {
    ...summarizeBindingBarcodes(facts),
    pendingCount: flows.filter((flow) => flow.status === "PENDING").length,
  };
}

type BindingApproverOption = BindingRequirementRow["approverOptions"][number];

function getBindingFlowsByRequirement(requirementIdsJson: string) {
  const flowRows = all<Omit<BindingFlowRow, "barcodes" | "barcodeResults">>(
    `SELECT f.id, f.flow_no AS flowNo, f.requirement_id AS requirementId, f.status,
            f.web_url AS webUrl, su.name AS submittedByName, f.submitted_by AS submittedById, f.submitted_at AS submittedAt,
            ap.name AS approverName, f.approver_id AS approverId, rv.name AS reviewedByName, f.reviewed_at AS reviewedAt,
            f.review_comment AS reviewComment, f.cancelled_at AS cancelledAt, f.cancel_reason AS cancelReason
     FROM binding_flows f
     LEFT JOIN users su ON su.id = f.submitted_by
     LEFT JOIN users ap ON ap.id = f.approver_id
     LEFT JOIN users rv ON rv.id = f.reviewed_by
     WHERE f.requirement_id IN (SELECT value FROM json_each(?))
     ORDER BY f.submitted_at DESC, f.id DESC`,
    requirementIdsJson,
  );
  const barcodeRows = flowRows.length === 0 ? [] : all<BindingBarcodeRow & { flowId: number }>(
    `SELECT b.flow_id AS flowId, b.id, b.barcode, b.validation_result AS result,
            b.failure_reason AS failureReason, b.validated_at AS validatedAt, validator.name AS validatedByName,
            b.failure_reason_at AS failureReasonAt, recorder.name AS failureReasonByName
     FROM binding_flow_barcodes b
     LEFT JOIN users validator ON validator.id = b.validated_by
     LEFT JOIN users recorder ON recorder.id = b.failure_reason_by
     WHERE b.flow_id IN (SELECT value FROM json_each(?)) ORDER BY b.id`,
    JSON.stringify(flowRows.map(({ id }) => id)),
  );
  const barcodesByFlow = new Map<number, BindingBarcodeRow[]>();
  for (const { flowId, ...barcode } of barcodeRows) {
    const group = barcodesByFlow.get(flowId) ?? [];
    group.push(barcode);
    barcodesByFlow.set(flowId, group);
  }
  const flows: BindingFlowRow[] = flowRows.map((flow) => {
    const barcodeResults = barcodesByFlow.get(flow.id) ?? [];
    return { ...flow, barcodeResults, barcodes: barcodeResults.map(({ barcode }) => barcode) };
  });
  return Map.groupBy(flows, ({ requirementId }) => requirementId);
}

function getBindingApproversByRequirement(
  requirementIdsJson: string,
  requirements: ReadonlyArray<Pick<BindingRequirementRow, "id" | "approverId" | "approverName">>,
) {
  const snapshots = all<BindingApproverOption & { requirementId: number }>(
    `SELECT bra.requirement_id AS requirementId, bra.user_id AS userId, u.name AS userName,
            u.employee_id AS userEmployeeId, u.is_active AS isActive
     FROM binding_requirement_approvers bra JOIN users u ON u.id = bra.user_id
     WHERE bra.requirement_id IN (SELECT value FROM json_each(?)) ORDER BY bra.id`,
    requirementIdsJson,
  );
  const approversByRequirement = new Map<number, BindingApproverOption[]>();
  for (const { requirementId, ...option } of snapshots) {
    const group = approversByRequirement.get(requirementId) ?? [];
    group.push(option);
    approversByRequirement.set(requirementId, group);
  }
  const legacyApprovers = new Map<number, number>();
  for (const { id, approverId, approverName } of requirements) {
    if (!approversByRequirement.has(id) && approverId && approverName) {
      legacyApprovers.set(id, approverId);
    }
  }
  if (legacyApprovers.size > 0) {
    const users = all<BindingApproverOption>(
      `SELECT id AS userId, name AS userName, employee_id AS userEmployeeId, is_active AS isActive
       FROM users WHERE id IN (SELECT value FROM json_each(?))`,
      JSON.stringify([...new Set(legacyApprovers.values())]),
    );
    const usersById = new Map(users.map((user) => [user.userId, user]));
    for (const [requirementId, userId] of legacyApprovers) {
      const user = usersById.get(userId);
      if (user) approversByRequirement.set(requirementId, [{ ...user }]);
    }
  }
  return approversByRequirement;
}

export function getTrialDetail(requestId: number): TrialDetail | null {
  const request = one<TrialDetail["request"]>(
    `SELECT r.id, pr.id AS projectId, pr.name AS projectName, pr.code AS projectCode, pr.status AS projectStatus,
            p.id AS packageId, p.name AS packageName, p.code AS packageCode, p.owner_id AS packageOwnerId, pv.id AS versionId,
            pv.version, r.status, pv.status AS versionStatus, pv.change_summary AS changeSummary, pv.archive_url AS archiveUrl,
            r.integration_status AS integrationStatus, ${ACTIVE_INTEGRATION_BATCH_COUNT_SQL} AS ongoingTestCount,
            r.trial_form_no AS trialFormNo, pv.trial_review_minutes AS trialReviewMinutes,
            r.trial_released_at AS trialReleasedAt,
            r.release_mode AS releaseMode, r.risk_conclusion AS riskConclusion,
            pv.binding_mode AS bindingMode, pv.binding_reason AS bindingReason,
            p.trial_overdue_days AS trialOverdueDays,
            CASE WHEN r.trial_released_at IS NOT NULL
                 AND datetime(r.trial_released_at, '+' || p.trial_overdue_days || ' days') < datetime('now')
                 THEN 1 ELSE 0 END AS isOverdue,
            b.id AS batchId, b.code AS batchCode, b.project_id AS batchProjectId, b.status AS batchStatus, b.conclusion AS batchConclusion,
            r.void_reason AS voidReason, pv.void_kind AS voidKind, r.voided_at AS voidedAt, o.name AS ownerName,
            sm.name AS softwareManagerName, pr.software_manager_id AS softwareManagerId
     FROM version_transfer_requests r
     JOIN package_versions pv ON pv.id = r.package_version_id
     JOIN packages p ON p.id = pv.package_id
     JOIN projects pr ON pr.id = r.project_id
     LEFT JOIN users o ON o.id = p.owner_id
     LEFT JOIN users sm ON sm.id = pr.software_manager_id
     LEFT JOIN integration_batches b ON b.id = ${LATEST_TRANSFER_REQUEST_BATCH_ID_SQL}
     WHERE r.id = ?`,
    requestId,
  );
  if (!request) return null;
  const requirementRows = all<Omit<BindingRequirementRow, "flows" | "approverOptions" | "approvedCount" | "submittedCount" | "pendingCount"
    | "passedBarcodeCount" | "unreviewedApprovedCount" | "failedBarcodeCount" | "barcodeEvidenceKey" | "legacyConfirmation">
    & { barcodeRevision: number; barcodeConfirmation: number }>(
    `SELECT br.id, br.project_id AS projectId, pr.name AS projectName, br.node_id AS nodeId,
            n.name AS nodeName, br.required_count AS requiredCount, br.status,
            br.barcode_revision AS barcodeRevision, br.barcode_confirmation AS barcodeConfirmation,
            br.binding_owner_id AS bindingOwnerId, bo.name AS bindingOwnerName,
            br.approver_id AS approverId, ba.name AS approverName,
            br.pushed_at AS pushedAt, pu.name AS pushedByName, br.decision_reason AS decisionReason,
            br.waived_at AS waivedAt, wu.name AS waivedByName,
            CASE WHEN br.status = 'PASSED' THEN br.confirmed_at END AS confirmedAt, cu.name AS confirmedByName
     FROM binding_requirements br
     JOIN projects pr ON pr.id = br.project_id
     JOIN project_nodes n ON n.id = br.node_id
     LEFT JOIN users bo ON bo.id = br.binding_owner_id
     LEFT JOIN users ba ON ba.id = br.approver_id
     LEFT JOIN users pu ON pu.id = br.pushed_by
     LEFT JOIN users wu ON wu.id = br.waived_by
     LEFT JOIN users cu ON cu.id = br.confirmed_by
     WHERE br.request_id = ? ORDER BY n.sort_order`,
    requestId,
  );
  if (requirementRows.length === 0) return { request, requirements: [] };
  const requirementIds = JSON.stringify(requirementRows.map(({ id }) => id));
  const flowsByRequirement = getBindingFlowsByRequirement(requirementIds);
  const approversByRequirement = getBindingApproversByRequirement(requirementIds, requirementRows);
  const requirements = requirementRows.map(({ barcodeRevision, barcodeConfirmation, ...requirement }) => {
    const flows = flowsByRequirement.get(requirement.id) ?? [];
    const approverOptions = approversByRequirement.get(requirement.id) ?? [];
    return {
      ...requirement,
      ...bindingFlowCounts(flows),
      barcodeEvidenceKey: bindingBarcodeEvidenceKey(barcodeRevision, flows),
      legacyConfirmation: requirement.status === "PASSED" && barcodeConfirmation === 0,
      approverOptions,
      flows,
    };
  });
  return { request, requirements };
}

type TrialRequestReadFacts = Pick<TrialDetail["request"], "projectId" | "packageOwnerId">;
type RequirementReadFacts = Pick<BindingRequirementRow, "bindingOwnerId" | "pushedAt">;
type FlowReadFacts = Pick<BindingFlowRow, "approverId" | "submittedById">;

function canReadEntireTrialRequest(userId: number, request: TrialRequestReadFacts, projectIds: number[] | null) {
  return projectIds === null || projectIds.includes(request.projectId) || request.packageOwnerId === userId;
}

function isPushedBindingOwner(userId: number, requirement: RequirementReadFacts) {
  return requirement.bindingOwnerId === userId && requirement.pushedAt !== null;
}

function isBindingFlowParticipant(userId: number, flow: FlowReadFacts) {
  return flow.approverId === userId || flow.submittedById === userId;
}

export function getReadableTrialDetail(user: SessionUser, requestId: number): TrialDetail | null {
  const detail = getTrialDetail(requestId);
  if (!detail) return null;
  const projectIds = getProjectWorkflowProjectIds(user, true);
  if (canReadEntireTrialRequest(user.id, detail.request, projectIds)) return detail;
  const requirements = detail.requirements.flatMap((requirement) => {
    if (isPushedBindingOwner(user.id, requirement)) return [requirement];
    const flows = requirement.flows.filter((flow) => isBindingFlowParticipant(user.id, flow));
    return flows.length ? [{ ...requirement, ...bindingFlowCounts(flows), barcodeEvidenceKey: "", flows, approverOptions: [] }] : [];
  });
  return requirements.length ? { ...detail, requirements } : null;
}

type TrialQueueBindingCounts = Pick<TrialVersionRow, "requirementTotal" | "requirementPassed" | "requirementWaived" | "pendingFlowCount">;
type TrialQueueBindingRow = TrialRequestReadFacts & RequirementReadFacts & FlowReadFacts & {
  requestId: number;
  requirementId: number | null;
  confirmedAt: string | null;
  waivedAt: string | null;
  flowPendingCount: number;
};

export function getReadableTrialQueueCounts(user: SessionUser, requestIds: number[]) {
  const countsByRequest = new Map<number, TrialQueueBindingCounts>();
  if (requestIds.length === 0) return countsByRequest;
  const projectIds = getProjectWorkflowProjectIds(user, true);
  // Any assigned flow makes its requirement visible. Only pending flows contribute to the queue count.
  const rows = all<TrialQueueBindingRow>(
    `WITH selected_requests AS (SELECT DISTINCT value AS id FROM json_each(?)),
          requirements AS MATERIALIZED (
            SELECT br.id, br.request_id, br.binding_owner_id, br.pushed_at,
                   CASE WHEN br.status = 'PASSED' THEN br.confirmed_at END AS confirmedAt, br.waived_at
            FROM selected_requests selected
            JOIN binding_requirements br ON br.request_id = selected.id
            JOIN projects project ON project.id = br.project_id
            JOIN project_nodes node ON node.id = br.node_id
          ),
          flow_counts AS MATERIALIZED (
            SELECT requirement_id, approver_id, submitted_by, COUNT(CASE WHEN status = 'PENDING' THEN 1 END) AS pendingCount
            FROM binding_flows WHERE requirement_id IN (SELECT id FROM requirements)
            GROUP BY requirement_id, approver_id, submitted_by
          )
     SELECT r.id AS requestId, pr.id AS projectId, p.owner_id AS packageOwnerId, br.id AS requirementId,
            br.binding_owner_id AS bindingOwnerId, br.pushed_at AS pushedAt, br.confirmedAt, br.waived_at AS waivedAt,
            COALESCE(f.pendingCount, 0) AS flowPendingCount, f.approver_id AS approverId, f.submitted_by AS submittedById
     FROM selected_requests selected
     JOIN version_transfer_requests r ON r.id = selected.id
     JOIN projects pr ON pr.id = r.project_id
     JOIN package_versions pv ON pv.id = r.package_version_id
     JOIN packages p ON p.id = pv.package_id
     LEFT JOIN requirements br ON br.request_id = r.id
     LEFT JOIN flow_counts f ON f.requirement_id = br.id`,
    JSON.stringify(requestIds),
  );
  for (const [requestId, records] of Map.groupBy(rows, (row) => row.requestId)) {
    const readAll = canReadEntireTrialRequest(user.id, records[0], projectIds);
    const counts = { requirementTotal: 0, requirementPassed: 0, requirementWaived: 0, pendingFlowCount: 0 };
    for (const [requirementId, flowGroups] of Map.groupBy(records, (row) => row.requirementId)) {
      if (requirementId === null) continue;
      const requirement = flowGroups[0];
      const readableGroups = readAll || isPushedBindingOwner(user.id, requirement)
        ? flowGroups
        : flowGroups.filter((flow) => isBindingFlowParticipant(user.id, flow));
      if (readableGroups.length === 0) continue;
      counts.requirementTotal += 1;
      counts.requirementPassed += Number(requirement.confirmedAt !== null);
      counts.requirementWaived += Number(requirement.waivedAt !== null);
      counts.pendingFlowCount += readableGroups.reduce((total, group) => total + group.flowPendingCount, 0);
    }
    if (readAll || counts.requirementTotal > 0) countsByRequest.set(requestId, counts);
  }
  return countsByRequest;
}

export function getManagedTrialRequestState(user: SessionUser, requestId: number, projectId?: number) {
  const request = one<{
    versionId: number;
    projectId: number;
    trialReleasedAt: string | null;
    versionStatus: string;
    projectStatus: string;
  }>(
    `SELECT r.package_version_id AS versionId, r.project_id AS projectId, r.trial_released_at AS trialReleasedAt,
            pv.status AS versionStatus, p.status AS projectStatus
     FROM version_transfer_requests r JOIN package_versions pv ON pv.id = r.package_version_id
     JOIN projects p ON p.id = r.project_id WHERE r.id = ?`,
    requestId,
  );
  if (!request || (projectId !== undefined && projectId !== request.projectId)) return null;
  return canManageProjectWorkflowForProject(user, request.projectId) ? request : null;
}

// Archived requests still provide a history landing when the last project leaves the formal queue.
export function hasReadableFormalHistory(user: SessionUser, versionId: number, projectId?: number): boolean {
  const readableProjects = getProjectWorkflowProjectIds(user, true);
  if (projectId !== undefined && readableProjects !== null && !readableProjects.includes(projectId)) return false;
  const scope = projectId === undefined ? readableProjects : [projectId];
  return Boolean(one(
    `SELECT 1 FROM version_transfer_requests
     WHERE package_version_id = ? AND trial_released_at IS NOT NULL
     ${scope === null ? "" : "AND project_id IN (SELECT value FROM json_each(?))"} LIMIT 1`,
    versionId,
    ...(scope === null ? [] : [JSON.stringify(scope)]),
  ));
}

export type PendingFormalVersion = {
  requestId: number;
  versionId: number;
  projectId: number;
  projectName: string;
  projectCode: string;
  packageId: number;
  packageName: string;
  packageCode: string;
  version: string;
  changeSummary: string;
  archiveUrl: string;
  trialFormNo: string | null;
  trialReleasedAt: string | null;
  bindingMode: "PENDING" | "PUSHED" | "SKIPPED";
  releaseMode: "INTEGRATION" | "RISK";
  ownerName: string | null;
  softwareManagerName: string | null;
  softwareManagerId: number | null;
  requirementTotal: number;
  requirementPassed: number;
  requirementWaived: number;
  trialOverdueDays: number;
  isOverdue: number;
};

export function getPendingFormalVersions(projectIds: number[] | null = null, versionId?: number): PendingFormalVersion[] {
  if (projectIds?.length === 0) return [];
  const scope = pendingRequestProjectScope(projectIds);
  return all<PendingFormalVersion>(
    `SELECT r.id AS requestId, pv.id AS versionId, pr.id AS projectId, pr.name AS projectName,
            pr.code AS projectCode, p.id AS packageId, p.name AS packageName, p.code AS packageCode,
            pv.version, pv.change_summary AS changeSummary, pv.archive_url AS archiveUrl,
            r.trial_form_no AS trialFormNo, r.trial_released_at AS trialReleasedAt,
            pv.binding_mode AS bindingMode, r.release_mode AS releaseMode,
            o.name AS ownerName, sm.name AS softwareManagerName, pr.software_manager_id AS softwareManagerId,
            pg.trial_overdue_days AS trialOverdueDays,
            CASE WHEN r.trial_released_at IS NOT NULL
                 AND datetime(r.trial_released_at, '+' || pg.trial_overdue_days || ' days') < datetime('now')
                 THEN 1 ELSE 0 END AS isOverdue,
            (SELECT COUNT(*) FROM binding_requirements br WHERE br.request_id = r.id) AS requirementTotal,
            (SELECT COUNT(*) FROM binding_requirements br WHERE br.request_id = r.id AND br.status = 'PASSED'
             AND br.confirmed_at IS NOT NULL) AS requirementPassed,
            (SELECT COUNT(*) FROM binding_requirements br WHERE br.request_id = r.id AND br.waived_at IS NOT NULL) AS requirementWaived
     FROM version_transfer_requests r
     JOIN package_versions pv ON pv.id = r.package_version_id
     JOIN packages p ON p.id = pv.package_id
     JOIN projects pr ON pr.id = r.project_id
     JOIN packages pg ON pg.id = p.id
     LEFT JOIN users o ON o.id = p.owner_id
     LEFT JOIN users sm ON sm.id = pr.software_manager_id
     WHERE pv.status = 'PENDING_FORMAL' AND r.status = 'PENDING_FORMAL' AND pr.status != 'ARCHIVED'
       ${versionId === undefined ? "" : "AND pv.id = ?"}
       ${scope.predicate}
     ORDER BY r.trial_released_at DESC, r.id DESC`,
    ...(versionId === undefined ? [] : [versionId]), ...scope.params,
  ).map((version) => ({
    ...version,
    requirementTotal: Number(version.requirementTotal),
    requirementPassed: Number(version.requirementPassed),
    requirementWaived: Number(version.requirementWaived),
  }));
}

// ---------- Personal workbench ----------

export type PersonalTask = {
  key: string;
  title: string;
  description: string;
  href: string;
  category: "approve" | "bind" | "test" | "manage" | "alert";
};

export type PersonalAlert = {
  key: string;
  title: string;
  description: string;
  href: string;
  tone: "warning" | "danger" | "success" | "info";
  at?: string;
};

export type MyVersion = {
  id: number;
  packageId: number;
  packageName: string;
  packageCode: string;
  version: string;
  status: string;
  updatedAt: string;
  projectSummary: string;
};

export type MyBindingFlow = {
  id: number;
  flowNo: string;
  packageName: string;
  packageCode: string;
  version: string;
  projectName: string;
  nodeName: string;
  barcodeCount: number;
  status: string;
  reviewComment: string | null;
  reviewedAt: string | null;
  requestId: number;
};

export type PersonalDashboard = {
  tasks: PersonalTask[];
  alerts: PersonalAlert[];
  notifications: PersonalAlert[];
  myVersions: MyVersion[];
  myBindingFlows: MyBindingFlow[];
  counts: { tasks: number; alerts: number; notifications: number; myActiveVersions: number };
};

function workbenchVersionLabel(row: { packageName: string; packageCode: string; version: string }) {
  const { code } = packageIdentity({ name: row.packageName, code: row.packageCode });
  return `${code} ${row.version}`;
}

export function getPersonalDashboard(user: SessionUser): PersonalDashboard {
  const tasks: PersonalTask[] = [];
  const alerts: PersonalAlert[] = [];
  const notifications: PersonalAlert[] = [];
  const managerScope = getManagedProjectScope(user);
  const managedProjectIdsJson = JSON.stringify(managerScope ?? []);
  const integrationProjectIds = getIntegrationManagedProjectIds(user.id);
  const integrationScope = user.role === "ADMIN" ? null : integrationProjectIds;

  const failedTests = all<{
    requestId: number;
    versionId: number;
    packageName: string;
    packageCode: string;
    version: string;
    projectName: string;
    status: string;
    updatedAt: string;
  }>(
    `SELECT r.id AS requestId, pv.id AS versionId, p.name AS packageName, p.code AS packageCode, pv.version,
            pr.name AS projectName, COALESCE(r.integration_status, r.status) AS status, r.updated_at AS updatedAt
     FROM version_transfer_requests r
     JOIN package_versions pv ON pv.id = r.package_version_id
     JOIN packages p ON p.id = pv.package_id
     JOIN projects pr ON pr.id = r.project_id
     WHERE pv.submitted_by = ? AND pv.status != 'VOID' AND COALESCE(r.integration_status, r.status) IN ('FAILED','BLOCKED')
     ORDER BY r.updated_at DESC`,
    user.id,
  );
  for (const failure of failedTests) {
    alerts.push({
      key: `failed-${failure.requestId}`,
      title: `${workbenchVersionLabel(failure)} 在 ${failure.projectName} 测试异常`,
      description: `集成测试：${failure.status === "FAILED" ? "不通过" : "无法验证"}`,
      href: `/versions/${failure.versionId}`,
      tone: failure.status === "FAILED" ? "danger" : "warning",
      at: failure.updatedAt,
    });
  }

  const voidedRiskTrials = all<{
    versionId: number;
    packageName: string;
    packageCode: string;
    version: string;
    voidReason: string;
    voidedAt: string;
  }>(
    `SELECT pv.id AS versionId, p.name AS packageName, p.code AS packageCode, pv.version,
            pv.void_reason AS voidReason, pv.voided_at AS voidedAt
     FROM package_versions pv JOIN packages p ON p.id = pv.package_id
     WHERE pv.void_kind = 'RISK_TEST_FAILURE' AND (
       pv.submitted_by = ? OR EXISTS (
         SELECT 1 FROM version_transfer_requests r
         JOIN project_software_managers psm ON psm.project_id = r.project_id
         WHERE r.package_version_id = pv.id AND psm.user_id = ?
       ) OR EXISTS (
         SELECT 1 FROM binding_requirements br
         WHERE br.package_version_id = pv.id AND br.binding_owner_id = ? AND br.pushed_at IS NOT NULL
       )
     ) ORDER BY pv.voided_at DESC`,
    user.id, user.id, user.id,
  );
  for (const trial of voidedRiskTrials) {
    alerts.push({
      key: `void-risk-trial-${trial.versionId}`,
      title: `${workbenchVersionLabel(trial)} 风险试制已作废`,
      description: trial.voidReason,
      href: `/versions/${trial.versionId}`,
      tone: "danger",
      at: trial.voidedAt,
    });
  }

  const rejectedFlows = all<{
    id: number;
    flowNo: string;
    packageName: string;
    packageCode: string;
    version: string;
    requestId: number;
    projectName: string;
    nodeName: string;
    reviewComment: string | null;
    reviewedAt: string | null;
  }>(
    `SELECT f.id, f.flow_no AS flowNo, p.name AS packageName, p.code AS packageCode, pv.version, r.id AS requestId,
            pr.name AS projectName, n.name AS nodeName, f.review_comment AS reviewComment,
            f.reviewed_at AS reviewedAt
     FROM binding_flows f
     JOIN binding_requirements br ON br.id = f.requirement_id
     JOIN version_transfer_requests r ON r.id = br.request_id
     JOIN package_versions pv ON pv.id = f.package_version_id
     JOIN packages p ON p.id = pv.package_id
     JOIN projects pr ON pr.id = f.project_id
     JOIN project_nodes n ON n.id = f.node_id
     WHERE f.submitted_by = ? AND f.status = 'REJECTED'
     ORDER BY f.reviewed_at DESC`,
    user.id,
  );
  for (const flow of rejectedFlows) {
    alerts.push({
      key: `rejected-flow-${flow.id}`,
      title: `绑定电子流 ${flow.flowNo} 被驳回`,
      description: `${workbenchVersionLabel(flow)} · ${flow.projectName}/${flow.nodeName}${flow.reviewComment ? `：${flow.reviewComment}` : ""}`,
      href: `/trial/${flow.requestId}#binding-flow-${flow.id}`,
      tone: "danger",
      at: flow.reviewedAt ?? undefined,
    });
  }

  const voidFlows = all<{
    id: number;
    flowNo: string;
    packageName: string;
    packageCode: string;
    version: string;
    requestId: number;
    projectName: string;
    nodeName: string;
    voidReason: string | null;
    status: string;
  }>(
    `SELECT f.id, f.flow_no AS flowNo, p.name AS packageName, p.code AS packageCode, pv.version, r.id AS requestId,
            pr.name AS projectName, n.name AS nodeName, r.void_reason AS voidReason, f.status
     FROM binding_flows f
     JOIN binding_requirements br ON br.id = f.requirement_id
     JOIN version_transfer_requests r ON r.id = br.request_id
     JOIN package_versions pv ON pv.id = f.package_version_id
     JOIN packages p ON p.id = pv.package_id
     JOIN projects pr ON pr.id = f.project_id
     JOIN project_nodes n ON n.id = f.node_id
     WHERE f.submitted_by = ? AND pv.status = 'VOID' AND f.status IN ${ACTIVE_BINDING_FLOW_STATUSES_SQL}
     ORDER BY f.submitted_at DESC`,
    user.id,
  );
  for (const flow of voidFlows) {
    alerts.push({
      key: `void-flow-${flow.id}`,
      title: flow.status === "APPROVED" ? "试制版本已作废，请撤销已通过的外部绑定" : "试制版本已作废，请撤销绑定电子流",
      description: `${workbenchVersionLabel(flow)} · ${flow.projectName}/${flow.nodeName} · ${flow.flowNo}${flow.voidReason ? ` · ${flow.voidReason}` : ""}`,
      href: `/trial/${flow.requestId}#binding-flow-${flow.id}`,
      tone: "danger",
    });
  }

  const bindingTasks = all<{
    requirementId: number;
    requestId: number;
    projectId: number;
    packageOwnerId: number | null;
    bindingOwnerId: number | null;
    packageName: string;
    packageCode: string;
    version: string;
    projectName: string;
    nodeName: string;
    requiredCount: number;
    pendingFlowId: number | null;
    barcodeFacts: string;
  }>(
    `SELECT br.id AS requirementId, r.id AS requestId, p.name AS packageName, p.code AS packageCode, pv.version, pr.id AS projectId,
            p.owner_id AS packageOwnerId, br.binding_owner_id AS bindingOwnerId,
            pr.name AS projectName, n.name AS nodeName, br.required_count AS requiredCount,
            (SELECT f.id FROM binding_flows f WHERE f.requirement_id = br.id AND f.status = 'PENDING'
             ORDER BY f.submitted_at, f.id LIMIT 1) AS pendingFlowId,
            (SELECT json_group_array(json_object('barcode', b.barcode, 'result', b.validation_result, 'flowStatus', f.status))
             FROM binding_flows f JOIN binding_flow_barcodes b ON b.flow_id = f.id
             WHERE f.requirement_id = br.id AND f.status IN ${ACTIVE_BINDING_FLOW_STATUSES_SQL}) AS barcodeFacts
     FROM binding_requirements br
     JOIN version_transfer_requests r ON r.id = br.request_id
     JOIN package_versions pv ON pv.id = br.package_version_id
     JOIN packages p ON p.id = pv.package_id
     JOIN projects pr ON pr.id = br.project_id
     JOIN project_nodes n ON n.id = br.node_id
     WHERE pr.status != 'ARCHIVED' AND r.status = 'TRIAL' AND pv.status = 'TRIAL'
       AND br.status = 'PENDING' AND br.pushed_at IS NOT NULL AND br.waived_at IS NULL
       AND (br.binding_owner_id = ? OR p.owner_id = ? OR ? = 1 OR br.project_id IN (SELECT value FROM json_each(?)))
     ORDER BY pr.sort_order, n.sort_order`,
    user.id, user.id, managerScope === null ? 1 : 0, managedProjectIdsJson,
  );
  for (const task of bindingTasks) {
    const counts = summarizeBindingBarcodes(JSON.parse(task.barcodeFacts) as BindingBarcodeFact[]);
    const { passedBarcodeCount, unreviewedApprovedCount, failedBarcodeCount } = counts;
    const { canConfirm: ready, submissionShortfall } = bindingBarcodeProgress(task.requiredCount, counts);
    const canConfirm = task.packageOwnerId === user.id || managerScope === null || managerScope.includes(task.projectId);
    const reviewAction = !canConfirm ? null : ready ? "确认节点通过" : unreviewedApprovedCount > 0 ? "判定设备条码"
      : failedBarcodeCount > 0 ? "核对失败条码" : null;
    if (!reviewAction && (ready || task.bindingOwnerId !== user.id)) continue;
    const waitingApproval = !reviewAction && task.pendingFlowId !== null && submissionShortfall === 0;
    const action = reviewAction ?? (waitingApproval ? "跟进电子流审批" : "提交绑定电子流");
    const linkTarget = waitingApproval ? `binding-flow-${task.pendingFlowId}` : `binding-node-${task.requirementId}`;
    const progress = `${task.projectName} / ${task.nodeName}，通过条码 ${passedBarcodeCount}/${task.requiredCount}`
      + (unreviewedApprovedCount > 0 ? ` · ${unreviewedApprovedCount} 条待判定` : "")
      + (failedBarcodeCount > 0 ? ` · ${failedBarcodeCount} 条 FAIL` : "");
    tasks.push({
      key: `binding-${task.requirementId}`,
      title: `${action}：${workbenchVersionLabel(task)}`,
      description: waitingApproval ? `${progress} · 已登记足量条码，等待审批` : progress,
      href: `/trial/${task.requestId}#${linkTarget}`,
      category: "bind",
    });
  }

  const approvals = all<{
    id: number;
    flowNo: string;
    packageName: string;
    packageCode: string;
    version: string;
    requestId: number;
    projectId: number;
    projectName: string;
    nodeName: string;
    submittedByName: string | null;
    barcodeCount: number;
  }>(
    `SELECT f.id, f.flow_no AS flowNo, p.name AS packageName, p.code AS packageCode, pv.version, r.id AS requestId, pr.id AS projectId,
            pr.name AS projectName, n.name AS nodeName, su.name AS submittedByName,
            (SELECT COUNT(*) FROM binding_flow_barcodes b WHERE b.flow_id = f.id) AS barcodeCount
     FROM binding_flows f
     JOIN binding_requirements br ON br.id = f.requirement_id
     JOIN version_transfer_requests r ON r.id = br.request_id
     JOIN package_versions pv ON pv.id = f.package_version_id
     JOIN packages p ON p.id = pv.package_id
     JOIN projects pr ON pr.id = f.project_id
     JOIN project_nodes n ON n.id = f.node_id
     LEFT JOIN users su ON su.id = f.submitted_by
     WHERE (? = 1 OR f.approver_id = ?) AND f.submitted_by IS NOT ? AND pr.status != 'ARCHIVED'
       AND f.status = 'PENDING' AND br.status IN ${OPEN_BINDING_REQUIREMENT_STATUSES_SQL}
       AND br.pushed_at IS NOT NULL AND br.waived_at IS NULL
       AND r.status IN ${OPEN_BINDING_RELEASE_STATUSES_SQL} AND pv.status IN ${OPEN_BINDING_RELEASE_STATUSES_SQL}
     ORDER BY f.submitted_at`,
    user.role === "ADMIN" ? 1 : 0,
    user.id,
    user.id,
  );
  for (const approval of approvals) {
    tasks.push({
      key: `approval-${approval.id}`,
      title: `审批绑定电子流：${approval.flowNo}`,
      description: `${workbenchVersionLabel(approval)} · ${approval.projectName}/${approval.nodeName} · ${approval.barcodeCount} 个条码${approval.submittedByName ? ` · ${approval.submittedByName}提交` : ""}`,
      href: `/trial/${approval.requestId}#binding-flow-${approval.id}`,
      category: "approve",
    });
  }

  if (managerScope === null || managerScope.length > 0) {
    const pendingGroups = getPendingTransferGroups(managerScope);
    for (const group of pendingGroups) {
      tasks.push({
        key: `transfer-${group.projectId}`,
        title: `${group.projectName} · ${group.items.length} 项待安排转测`,
        description: group.items.slice(0, 4).map(workbenchVersionLabel).join("、")
          + (group.items.length > 4 ? " 等" : ""),
        href: workflowHref("/submissions", group.projectId),
        category: "test",
      });
    }
    const batches = getBatches(-1, managerScope, { statuses: ["DRAFT", "IN_TEST"], activeProjectsOnly: true });
    for (const batch of batches.filter((entry) => entry.status === "DRAFT")) {
      tasks.push({
        key: `batch-draft-${batch.id}`,
        title: `核对待发起批次：${batch.code} · ${batch.projectName}`,
        description: `${batch.itemCount} 个配套软件包`,
        href: workflowHref(`/integration/${batch.id}`, batch.projectId),
        category: "test",
      });
    }
    for (const batch of batches.filter((entry) => entry.status === "IN_TEST" && integrationScope !== null && !integrationScope.includes(entry.projectId))) {
      tasks.push({
        key: `batch-manager-${batch.id}`,
        title: `跟踪测试进度：${batch.code} · ${batch.projectName}`,
        description: `${batch.changedCount} 个变更包 · 待集成测试负责人出结论`,
        href: workflowHref(`/integration/${batch.id}`, batch.projectId),
        category: "test",
      });
    }
    const ready = Array.from(new Map(getTrialReadyVersions(managerScope).map((item) => [item.versionId, item])).values());
    if (ready.length > 0) {
      const riskCount = ready.filter((version) => version.riskProjectCount > 0).length;
      tasks.push({
        key: "trial-ready",
        title: `${ready.length} 个版本待发试制${riskCount > 0 ? `（${riskCount} 个风险试制）` : ""}`,
        description: ready.slice(0, 4).map((version) => `${version.projectName} · ${workbenchVersionLabel(version)}`).join("、"),
        href: "/trial",
        category: "manage",
      });
    }
    const pendingDecisions = all<{ requestId: number; versionId: number; projectId: number; projectName: string; packageName: string; packageCode: string; version: string }>(
      `SELECT r.id AS requestId, pv.id AS versionId, pr.id AS projectId, pr.name AS projectName,
              p.name AS packageName, p.code AS packageCode, pv.version
       FROM package_versions pv
       JOIN packages p ON p.id = pv.package_id
       JOIN version_transfer_requests r ON r.package_version_id = pv.id
       JOIN projects pr ON pr.id = r.project_id
       WHERE pv.status = 'TRIAL' AND pv.binding_mode = 'PENDING' AND r.status = 'TRIAL' AND pr.status != 'ARCHIVED'
         AND (? = 1 OR pr.id IN (SELECT value FROM json_each(?)))
       ORDER BY r.trial_released_at DESC, r.id DESC`,
      managerScope === null ? 1 : 0,
      managedProjectIdsJson,
    );
    const bindingDecisions = new Map(pendingDecisions.map((version) => [version.versionId, version]));
    for (const version of bindingDecisions.values()) {
      tasks.push({
        key: `binding-decision-${version.versionId}`,
        title: `决定绑定方式：${workbenchVersionLabel(version)}`,
        description: `${version.projectName} · 已发布试制，待推送绑定或登记整版免绑`,
        href: workflowHref(`/trial/${version.requestId}`, version.projectId),
        category: "manage",
      });
    }
    const pendingFormal = Array.from(new Map(getPendingFormalVersions(managerScope).map((item) => [item.versionId, item])).values());
    const pendingFlows = getPendingBindingFlowCounts(db, pendingFormal.map(({ versionId }) => versionId));
    for (const version of pendingFormal) {
      const pending = pendingFlows.get(version.versionId) ?? 0;
      tasks.push({
        key: `formal-${version.versionId}`,
        title: `${pending > 0 ? "处理待审批电子流" : "核对并转正"}：${workbenchVersionLabel(version)}`,
        description: `${version.projectName} · ${pending > 0 ? `${pending} 条绑定电子流待处理` : "待提交转正电子流"}`,
        href: workflowHref(`/formal/${version.versionId}`, version.projectId),
        category: "manage",
      });
    }
  }

  if (integrationProjectIds.length > 0 || user.role === "ADMIN") {
    const testBatches = getBatches(-1, integrationScope, { statuses: ["IN_TEST"], activeProjectsOnly: true });
    for (const batch of testBatches) {
      tasks.push({
        key: `integration-test-${batch.id}`,
        title: `提交测试结论：${batch.code} · ${batch.projectName}`,
        description: `${batch.changedCount} 个变更包`,
        href: workflowHref(`/integration/${batch.id}`, batch.projectId),
        category: "test",
      });
    }
  }

  const myVersions = all<MyVersion>(
    `SELECT pv.id, p.id AS packageId, p.name AS packageName, p.code AS packageCode, pv.version, pv.status, pv.updated_at AS updatedAt,
            COALESCE((
              SELECT GROUP_CONCAT(pr.name || '·' || CASE r.status
                WHEN 'PENDING' THEN '待测试' WHEN 'IN_TEST' THEN '测试中'
                WHEN 'PASSED' THEN CASE WHEN pv.status = 'PENDING_TRIAL' THEN '待发试制' ELSE '测试通过' END
                WHEN 'FAILED' THEN '不通过'
                WHEN 'BLOCKED' THEN '无法验证' WHEN 'TRIAL' THEN '试制中'
                WHEN 'PENDING_FORMAL' THEN '待转正' WHEN 'FORMAL' THEN '已转正'
                WHEN 'VOID' THEN '已作废' ELSE r.status END, ' / ')
              FROM version_transfer_requests r JOIN projects pr ON pr.id = r.project_id
              WHERE r.package_version_id = pv.id
            ), '') AS projectSummary
     FROM package_versions pv
     JOIN packages p ON p.id = pv.package_id
     WHERE pv.submitted_by = ?
     ORDER BY pv.updated_at DESC, pv.id DESC LIMIT 12`,
    user.id,
  );

  const myBindingFlows = all<MyBindingFlow>(
    `SELECT f.id, f.flow_no AS flowNo, p.name AS packageName, p.code AS packageCode, pv.version,
            pr.name AS projectName, n.name AS nodeName, f.status,
            f.review_comment AS reviewComment, f.reviewed_at AS reviewedAt, r.id AS requestId,
            (SELECT COUNT(*) FROM binding_flow_barcodes b WHERE b.flow_id = f.id) AS barcodeCount
     FROM binding_flows f
     JOIN binding_requirements br ON br.id = f.requirement_id
     JOIN version_transfer_requests r ON r.id = br.request_id
     JOIN package_versions pv ON pv.id = f.package_version_id
     JOIN packages p ON p.id = pv.package_id
     JOIN projects pr ON pr.id = f.project_id
     JOIN project_nodes n ON n.id = f.node_id
     WHERE f.submitted_by = ?
     ORDER BY f.submitted_at DESC LIMIT 12`,
    user.id,
  );
  for (const flow of myBindingFlows) {
    if (flow.status === "APPROVED") {
      notifications.push({
        key: `flow-notice-${flow.id}`,
        title: `绑定电子流 ${flow.flowNo} 已通过`,
        description: `${workbenchVersionLabel(flow)} · ${flow.projectName}/${flow.nodeName}${flow.reviewComment ? `：${flow.reviewComment}` : ""}`,
        href: `/trial/${flow.requestId}#binding-flow-${flow.id}`,
        tone: "success",
        at: flow.reviewedAt ?? undefined,
      });
    }
  }

  const readKeys = getReadNotificationKeys(user.id);
  const unreadAlerts = alerts.filter((alert) => !readKeys.has(alert.key)
    && (!alert.key.startsWith("rejected-flow-") || !readKeys.has(alert.key.replace("rejected-flow-", "flow-notice-"))));
  const unreadNotifications = notifications.filter((notification) => !readKeys.has(notification.key));
  const activeVersions = one<{ count: number }>(
    "SELECT COUNT(*) AS count FROM package_versions WHERE submitted_by = ? AND status NOT IN ('FORMAL', 'VOID')",
    user.id,
  )?.count ?? 0;

  return {
    tasks,
    alerts: unreadAlerts,
    notifications: unreadNotifications,
    myVersions,
    myBindingFlows,
    counts: {
      tasks: tasks.length,
      alerts: unreadAlerts.length,
      notifications: unreadNotifications.length,
      myActiveVersions: activeVersions,
    },
  };
}

export function hasVersionRequest(requestId: number, versionId: number): boolean {
  return Boolean(one(
    "SELECT id FROM version_transfer_requests WHERE id = ? AND package_version_id = ?",
    requestId, versionId,
  ));
}

export function getVersionRequestIds(versionId: number): number[] {
  return all<{ id: number }>(
    `SELECT r.id FROM version_transfer_requests r
     JOIN projects pr ON pr.id = r.project_id
     WHERE r.package_version_id = ? AND pr.status != 'ARCHIVED'
     ORDER BY pr.sort_order`,
    versionId,
  ).map((row) => row.id);
}

export type VersionTrace = {
  version: {
    id: number;
    packageId: number;
    packageName: string;
    packageCode: string;
    version: string;
    status: string;
    changeSummary: string;
    archiveUrl: string;
    buildUrl: string | null;
    submittedByName: string | null;
    submittedAt: string;
    trialFormNo: string | null;
    trialReviewMinutes: string | null;
    trialReleasedAt: string | null;
    formalReleasedAt: string | null;
    formFlowNo: string | null;
    formalReviewMinutes: string | null;
    releaseMode: "INTEGRATION" | "RISK";
    riskConclusion: string | null;
    voidReason: string | null;
    voidedAt: string | null;
  };
  requests: Array<{
    requestId: number;
    projectId: number;
    projectName: string;
    projectCode: string;
    status: string;
    integrationStatus: string | null;
    trialFormNo: string | null;
    trialReleasedAt: string | null;
    formalReleasedAt: string | null;
    formFlowNo: string | null;
    releaseMode: "INTEGRATION" | "RISK";
    riskConclusion: string | null;
    batchTestSummary: string | null;
    batchReportUrl: string | null;
  } & LinkedBatchEvidence>;
  batches: Array<{
    id: number;
    code: string;
    projectId: number;
    projectName: string;
    status: string;
    conclusion: string | null;
    createdAt: string;
    sentAt: string | null;
    completedAt: string | null;
    testSummary: string | null;
    testReportUrl: string | null;
  }>;
  details: TrialDetail[];
};

export function getVersionTrace(user: SessionUser, versionId: number, projectId?: number, readableIds = getReadableVersionIds(user)): VersionTrace | null {
  if (readableIds !== null && !readableIds.includes(versionId)) return null;
  const version = one<VersionTrace["version"]>(
    `SELECT pv.id, p.id AS packageId, p.name AS packageName, p.code AS packageCode, pv.version,
            pv.status, pv.change_summary AS changeSummary, pv.archive_url AS archiveUrl,
            pv.build_url AS buildUrl, su.name AS submittedByName, pv.submitted_at AS submittedAt,
            pv.trial_form_no AS trialFormNo, pv.trial_review_minutes AS trialReviewMinutes,
            pv.trial_released_at AS trialReleasedAt, pv.formal_released_at AS formalReleasedAt,
            pv.form_flow_no AS formFlowNo, pv.formal_review_minutes AS formalReviewMinutes,
            pv.release_mode AS releaseMode, pv.risk_conclusion AS riskConclusion,
            pv.void_reason AS voidReason, pv.voided_at AS voidedAt
     FROM package_versions pv
     JOIN packages p ON p.id = pv.package_id
     LEFT JOIN users su ON su.id = pv.submitted_by
     WHERE pv.id = ?`,
    versionId,
  );
  if (!version) return null;
  const requests = all<VersionTrace["requests"][number]>(
    `SELECT r.id AS requestId, pr.id AS projectId, pr.name AS projectName, pr.code AS projectCode,
            r.status, r.integration_status AS integrationStatus, r.trial_form_no AS trialFormNo,
            r.trial_released_at AS trialReleasedAt,
            r.formal_released_at AS formalReleasedAt, r.form_flow_no AS formFlowNo,
            r.release_mode AS releaseMode, r.risk_conclusion AS riskConclusion,
            b.id AS batchId, b.code AS batchCode, b.project_id AS batchProjectId, b.status AS batchStatus,
            b.conclusion AS batchConclusion, b.test_summary AS batchTestSummary,
            b.test_report_url AS batchReportUrl
     FROM version_transfer_requests r
     JOIN projects pr ON pr.id = r.project_id
     LEFT JOIN integration_batches b ON b.id = ${LATEST_TRANSFER_REQUEST_BATCH_ID_SQL}
     WHERE r.package_version_id = ? AND (? IS NULL OR pr.id = ?)
     ORDER BY pr.sort_order`,
    versionId,
    projectId ?? null,
    projectId ?? null,
  );
  const batches = all<VersionTrace["batches"][number]>(
    `SELECT DISTINCT b.id, b.code, pr.id AS projectId, pr.name AS projectName, b.status,
            b.conclusion, b.created_at AS createdAt, b.sent_at AS sentAt, b.completed_at AS completedAt,
            b.test_summary AS testSummary, b.test_report_url AS testReportUrl
     FROM batch_items bi
     JOIN integration_batches b ON b.id = bi.batch_id
     JOIN projects pr ON pr.id = b.project_id
     WHERE bi.package_version_id = ? AND (? IS NULL OR pr.id = ?)
     ORDER BY b.created_at DESC`,
    versionId,
    projectId ?? null,
    projectId ?? null,
  );
  if (projectId && requests.length === 0 && batches.length === 0) {
    const standalone = one<{ id: number }>(
      `SELECT pv.id FROM package_versions pv WHERE pv.id = ? AND ${STANDALONE_VERSION_HISTORY_IN_PROJECT_SQL}`,
      versionId,
      projectId,
    );
    if (!standalone) return null;
  }
  const batchScope = getBatchEvidenceReadScope(user);
  const readableProjects = batchScope.projectIds;
  const hasProjectEvidence = (id: number) => readableProjects === null || readableProjects.includes(id);
  const hasBatchEvidence = (id: number, status: string | null) => canReadBatchEvidence(user, id, status, batchScope);
  const readableBatches = batches.filter((batch) => hasBatchEvidence(batch.projectId, batch.status));
  if (projectId && requests.length === 0 && readableBatches.length === 0 && batches.length > 0) return null;
  const narrowRequests = readableProjects === null ? [] : getNarrowVersionRequestIds(user, versionId);
  const safeRequests = requests.filter(({ projectId, requestId }) => hasProjectEvidence(projectId) || narrowRequests.includes(requestId));
  if (projectId && requests.length > 0 && safeRequests.length === 0 && readableBatches.length === 0) return null;
  const canReadLinkedBatch = (request: LinkedBatchEvidence & { projectId: number }) =>
    hasProjectEvidence(request.projectId)
    && (projectId === undefined || request.batchProjectId === projectId)
    && getReadableLinkedBatchEvidence(user, request, batchScope) !== null;
  const hiddenBatch = { batchId: null, batchProjectId: null, batchCode: null, batchStatus: null, batchConclusion: null };
  const projectedRequests = safeRequests.map((request) => canReadLinkedBatch(request) ? request : {
    ...request,
    ...hiddenBatch,
    batchTestSummary: null,
    batchReportUrl: null,
  });
  const details = safeRequests.flatMap(({ requestId }) => {
    const detail = getReadableTrialDetail(user, requestId);
    if (!detail) return [];
    return [canReadLinkedBatch(detail.request) ? detail : { ...detail, request: { ...detail.request, ...hiddenBatch } }];
  });
  return { version, requests: projectedRequests, batches: readableBatches, details };
}

export type ProjectVersionRow = LinkedBatchEvidence & {
  requestId: number;
  versionId: number;
  packageId: number;
  packageName: string;
  packageCode: string;
  version: string;
  status: string;
  trialFormNo: string | null;
  trialReleasedAt: string | null;
  formFlowNo: string | null;
  formalReleasedAt: string | null;
  releaseMode: "INTEGRATION" | "RISK";
  riskConclusion: string | null;
  bindingMode: "PENDING" | "PUSHED" | "SKIPPED" | null;
  isOverdue: number;
};

export function getProjectVersionRows(projectId: number, limit = -1): ProjectVersionRow[] {
  return all<ProjectVersionRow>(
    `SELECT r.id AS requestId, pv.id AS versionId, p.id AS packageId, p.name AS packageName,
            p.code AS packageCode, pv.version, r.status, r.trial_form_no AS trialFormNo,
            r.trial_released_at AS trialReleasedAt, r.form_flow_no AS formFlowNo,
            r.formal_released_at AS formalReleasedAt, r.release_mode AS releaseMode,
            r.risk_conclusion AS riskConclusion, pv.binding_mode AS bindingMode,
            CASE WHEN r.trial_released_at IS NOT NULL AND pv.status NOT IN ('FORMAL','VOID')
                 AND datetime(r.trial_released_at, '+' || p.trial_overdue_days || ' days') < datetime('now')
                 THEN 1 ELSE 0 END AS isOverdue,
            b.id AS batchId, b.code AS batchCode, b.project_id AS batchProjectId, b.status AS batchStatus,
            b.conclusion AS batchConclusion
     FROM version_transfer_requests r
     JOIN package_versions pv ON pv.id = r.package_version_id
     JOIN packages p ON p.id = pv.package_id
     LEFT JOIN integration_batches b ON b.id = ${LATEST_TRANSFER_REQUEST_BATCH_ID_SQL}
     WHERE r.project_id = ?
     ORDER BY pv.submitted_at DESC, pv.id DESC LIMIT ?`,
    projectId,
    limit,
  );
}

export type TraceVersionRow = Pick<VersionTrace["version"],
  "id" | "packageId" | "packageName" | "packageCode" | "version" | "status" | "submittedAt">;

const traceVersionFields = `SELECT pv.id, p.id AS packageId, p.name AS packageName, p.code AS packageCode,
  pv.version, pv.status, pv.submitted_at AS submittedAt`;
const traceVersionsFrom = "FROM package_versions pv JOIN packages p ON p.id = pv.package_id";
const traceSubmittedDate = "date(pv.submitted_at, '+8 hours')";
const traceSortSql = {
  package: `${packageCodeSql("p.name", "p.code")} COLLATE NOCASE`,
  version: "pv.version COLLATE NOCASE",
  status: `CASE pv.status
    WHEN 'PENDING_TRANSFER' THEN 1 WHEN 'IN_TEST' THEN 2 WHEN 'PENDING_TRIAL' THEN 3
    WHEN 'TRIAL' THEN 4 WHEN 'PENDING_FORMAL' THEN 5 WHEN 'FORMAL' THEN 6 ELSE 7 END`,
  submitted: "julianday(pv.submitted_at)",
} as const;

function traceProjectScope(projectId?: number) {
  return projectId === undefined ? { condition: "1 = 1", values: [] } : {
    condition: `(EXISTS (
      SELECT 1 FROM version_transfer_requests r WHERE r.package_version_id = pv.id AND r.project_id = ?
    ) OR EXISTS (
      SELECT 1 FROM batch_items bi JOIN integration_batches b ON b.id = bi.batch_id
      WHERE bi.package_version_id = pv.id AND b.project_id = ?
    ) OR (${STANDALONE_VERSION_HISTORY_IN_PROJECT_SQL}))`,
    values: [projectId, projectId, projectId],
  };
}

export function getTraceVersionPage(state: TraceListState, projectId?: number, readableIds: number[] | null = null) {
  const scope = traceProjectScope(projectId);
  const conditions = [scope.condition];
  const params: Array<string | number> = [...scope.values];
  if (readableIds !== null) {
    conditions.push("pv.id IN (SELECT value FROM json_each(?))");
    params.push(JSON.stringify(readableIds));
  }
  const columns = state.filters;
  const packageExact = columns.f_package_mode === "exact";
  const filters: Array<[string, string | number | undefined]> = [
    ["p.id = ?", state.packageId],
    ["instr(lower(p.code || ' ' || p.name), lower(?)) > 0", packageExact ? undefined : columns.f_package],
    [
      columns.f_version_mode === "exact" ? "pv.version = ? COLLATE NOCASE" : "instr(lower(pv.version), lower(?)) > 0",
      columns.f_version,
    ],
    [`${traceSubmittedDate} >= ?`, columns.f_submitted_min],
    [`${traceSubmittedDate} <= ?`, columns.f_submitted_max],
  ];
  for (const term of state.query.split(/\s+/).filter(Boolean)) {
    filters.push(["instr(lower(p.code || ' ' || p.name || ' ' || pv.version), lower(?)) > 0", term]);
  }
  for (const [condition, value] of filters) {
    if (value === undefined || value === "") continue;
    conditions.push(condition);
    params.push(value);
  }
  if (packageExact && columns.f_package) {
    conditions.push("(p.code = ? COLLATE NOCASE OR p.name = ? COLLATE NOCASE)");
    params.push(columns.f_package, columns.f_package);
  }
  if (columns.f_status) {
    const statuses = columns.f_status.split(",");
    conditions.push(`pv.status IN (${statuses.map(() => "?").join(", ")})`);
    params.push(...statuses);
  }

  const where = conditions.join(" AND ");
  const total = one<{ total: number }>(`SELECT COUNT(*) AS total ${traceVersionsFrom} WHERE ${where}`, ...params)?.total ?? 0;
  const { current: page, pages: pageCount, offset } = getPageWindow(total, state.pageSize, state.page);
  const direction = state.direction === "asc" ? "ASC" : "DESC";
  const rows = all<TraceVersionRow>(
    `${traceVersionFields} ${traceVersionsFrom} WHERE ${where}
     ORDER BY ${traceSortSql[state.sort]} ${direction}, pv.id DESC LIMIT ? OFFSET ?`,
    ...params, state.pageSize, offset,
  );
  return { rows, total, page, pageCount };
}

export function getTraceVersionTabs(ids: number[], projectId?: number, readableIds: number[] | null = null): TraceVersionRow[] {
  const allowed = readableIds === null ? ids : ids.filter((id) => readableIds.includes(id));
  if (allowed.length === 0) return [];
  const scope = traceProjectScope(projectId);
  const rows = all<TraceVersionRow>(
    `${traceVersionFields} ${traceVersionsFrom}
     WHERE ${scope.condition} AND pv.id IN (${allowed.map(() => "?").join(", ")})`,
    ...scope.values, ...allowed,
  );
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => rowsById.get(id) ?? []);
}
