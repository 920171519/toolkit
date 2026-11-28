import "server-only";

import { canReadBatchEvidence, getReadableBatchEvidenceIds } from "./access";
import type { BatchConclusion, BatchStatus } from "./constants";
import { all, db, one } from "./db";
import { PARALLEL_RISK_TRIAL_ITEM_SQL } from "./integration-conclusion";
import type { readIntegrationHistory } from "./integration-history";
import { getPageWindow } from "./list-pagination";
import { packageCodeSql } from "./package-identity";
import { EFFECTIVE_INTEGRATION_STATUS_SQL, getPreviousBatchVersions } from "./transfer-requests";
import type { SessionUser } from "./types";
import { storedTestReportHref } from "./workflow-links";

export function getNextBatchCode(): string {
  const batch = one<{ highest: number | null }>(
    `SELECT MAX(CAST(SUBSTR(code, 2) AS INTEGER)) AS highest FROM integration_batches
     WHERE UPPER(code) GLOB 'B[0-9]*' AND SUBSTR(code, 2) NOT GLOB '*[^0-9]*'`,
  );
  return `B${String(Math.max(120, batch?.highest ?? 0) + 1).padStart(3, "0")}`;
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
const batchProjectFrom = `FROM integration_batches b JOIN projects pr ON pr.id = b.project_id`;
const batchSummaryFrom = `${batchProjectFrom}
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

export function getWorkbenchBatches(projectIds: number[] | null, status: "DRAFT" | "IN_TEST") {
  if (projectIds?.length === 0) return [];
  const { predicates, values } = batchFilterConditions(projectIds, { statuses: [status], activeProjectsOnly: true });
  const packageCount = status === "DRAFT" ? batchItemCount : batchChangedCount;
  return all<Pick<BatchSummaryRow, "id" | "code" | "projectId" | "projectName"> & { packageCount: number }>(
    `SELECT b.id, b.code, b.project_id AS projectId, pr.name AS projectName, ${packageCount} AS packageCount
     ${batchProjectFrom} ${batchWhere(predicates)} ${batchSummaryOrder}`,
    ...values,
  );
}

export function getBatchCount(projectIds: number[] | null, filters: BatchFilters): number {
  if (projectIds?.length === 0) return 0;
  const { predicates, values } = batchFilterConditions(projectIds, filters);
  return one<{ count: number }>(
    `SELECT COUNT(*) AS count ${batchProjectFrom} ${batchWhere(predicates)}`,
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
  const report = one<{ originalName: string; storedPath: string; storedMediaType: unknown; uploadedBy: number | null }>(
    `SELECT original_name AS originalName, stored_path AS storedPath, mime_type AS storedMediaType, uploaded_by AS uploadedBy
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
    storedTestReportHref(reportId),
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
