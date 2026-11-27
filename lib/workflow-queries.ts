import { all, db, one } from "./db";
import { canAccessProjectPage, getIntegrationManagedProjectIds, getManagedProjectIdsForUser, getNarrowVersionRequestIds, getProjectWorkflowProjectIds, getReadableVersionIds } from "./access";
import { bindingBarcodeEvidenceKey, type BindingBarcodeResult } from "./binding-barcode-results";
import type { BatchStatus } from "./constants";
import type { readIntegrationHistory } from "./integration-history";
import { packageCodeSql, packageIdentity } from "./package-identity";
import type { SessionUser } from "./types";
import { STANDALONE_VERSION_HISTORY_IN_PROJECT_SQL } from "./version-scope";
import type { TraceListState } from "./version-trace-list";
import { workflowHref } from "./workflow-links";
import { trialEligibilityCtes } from "./trial-eligibility";
import { getPendingBindingFlowCounts } from "./trial-readiness";
import { TRIAL_PENDING_VERSION_STATUSES_SQL } from "./transfer-requests";

export type ProjectOption = { id: number; name: string; code: string; status: string };

export function getNextBatchCode(): string {
  const batch = one<{ highest: number | null }>(
    `SELECT MAX(CAST(SUBSTR(code, 2) AS INTEGER)) AS highest FROM integration_batches
     WHERE UPPER(code) GLOB 'B[0-9]*' AND SUBSTR(code, 2) NOT GLOB '*[^0-9]*'`,
  );
  return `B${String(Math.max(120, batch?.highest ?? 0) + 1).padStart(3, "0")}`;
}

export function getProjectOptions(includeArchived = false): ProjectOption[] {
  return all<ProjectOption>(
    `SELECT id, name, code, status FROM projects
     ${includeArchived ? "" : "WHERE status != 'ARCHIVED'"} ORDER BY sort_order, id`,
  );
}

export function getManagedProjectIds(user: SessionUser): number[] {
  if (user.role === "ADMIN") return getProjectOptions().map((project) => project.id);
  return all<{ id: number }>(
    `SELECT p.id FROM project_software_managers psm
     JOIN projects p ON p.id = psm.project_id
     WHERE psm.user_id = ? AND p.status != 'ARCHIVED'
     ORDER BY p.sort_order`,
    user.id,
  ).map((row) => row.id);
}

export function getWorkflowProjectScope(user: SessionUser, includeArchived = false): number[] | null {
  return getProjectWorkflowProjectIds(user, includeArchived);
}

function filterByProject<T extends { projectId: number | null }>(rows: T[], projectIds: number[] | null): T[] {
  if (projectIds === null) return rows;
  const allowed = new Set(projectIds);
  return rows.filter((row) => row.projectId !== null && allowed.has(row.projectId));
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
            p.is_active AS packageActive, draft.id AS draftBatchId, draft.code AS draftBatchCode,
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
     WHERE pv.status != 'VOID' AND r.status IN ('PENDING','TRIAL','PENDING_FORMAL') AND COALESCE(r.integration_status, r.status) = 'PENDING'
       AND pr.status != 'ARCHIVED'
       AND ((draft.id IS NULL AND EXISTS (
         SELECT 1 FROM package_usages u WHERE u.package_id = pv.package_id AND u.project_id = r.project_id
       )) OR ${guideScope})
     ORDER BY pr.sort_order, pr.id, pv.submitted_at DESC, pv.id DESC`,
    ...(guidanceProjectIds ?? []),
  );
  const groups = new Map<number, PendingTransferGroup>();
  for (const row of filterByProject(rows, projectIds)) {
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

type PreviousBatchVersion = { versionId: number; version: string; canCarry: number };

const previousBatchVersionFields = `bi.package_version_id AS versionId, bi.version,
  pv.status != 'VOID' AND COALESCE(
    CASE WHEN r.status IN ('PENDING','TRIAL','PENDING_FORMAL') THEN COALESCE(r.integration_status, r.status)
         ELSE r.status END NOT IN ('VOID','CANCELLED','PENDING'), 1
  ) AS canCarry`;
const previousBatchVersionFrom = `FROM batch_items bi JOIN integration_batches b ON b.id = bi.batch_id
  JOIN package_versions pv ON pv.id = bi.package_version_id
  LEFT JOIN version_transfer_requests r ON r.package_version_id = pv.id AND r.project_id = b.project_id`;
const previousBatchVersionOrder = "COALESCE(b.completed_at, b.sent_at) DESC, bi.id DESC";

export function getPreviousBatchVersion(projectId: number, packageId: number) {
  return one<PreviousBatchVersion>(
    `SELECT ${previousBatchVersionFields}
     ${previousBatchVersionFrom}
     WHERE b.project_id = ? AND bi.package_id = ? AND b.status IN ('IN_TEST','COMPLETED')
     ORDER BY ${previousBatchVersionOrder} LIMIT 1`,
    projectId,
    packageId,
  );
}

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
  const previousByPackage = new Map(
    all<PreviousBatchVersion & { packageId: number }>(
      `SELECT packageId, versionId, version, canCarry FROM (
         SELECT bi.package_id AS packageId, ${previousBatchVersionFields},
                ROW_NUMBER() OVER (
                  PARTITION BY bi.package_id ORDER BY ${previousBatchVersionOrder}
                ) AS position
         ${previousBatchVersionFrom}
         WHERE b.project_id = ? AND b.status IN ('IN_TEST','COMPLETED')
       ) WHERE position = 1`,
      projectId,
    ).map((row) => [row.packageId, row]),
  );
  const projectRequests = all<{ requestId: number; versionId: number; status: string; reserved: number }>(
    `SELECT r.id AS requestId, r.package_version_id AS versionId,
            CASE WHEN r.status IN ('PENDING','TRIAL','PENDING_FORMAL')
              THEN COALESCE(r.integration_status, r.status) ELSE r.status END AS status,
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
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(state.page, pages);
  const rows = total === 0 ? [] : all<BatchSummaryRow>(
    `SELECT ${batchSummaryColumns} ${batchSummaryFrom}
     WHERE ${where} ${batchSummaryOrder} LIMIT ? OFFSET ?`,
    ...values, pageSize, (page - 1) * pageSize,
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

export function getBatchDetail(batchId: number, projectIds: number[] | null): BatchDetailRow | null {
  if (projectIds?.length === 0) return null;
  const scope = projectIds ? `AND b.project_id IN (${projectIds.map(() => "?").join(", ")})` : "";
  const batch = one<BatchSummaryRow>(
    `SELECT ${batchSummaryColumns} ${batchSummaryFrom} WHERE b.id = ? ${scope}`,
    batchId, ...(projectIds ?? []),
  );
  if (!batch) return null;
  const items = all<Omit<BatchItemRow, "isChanged" | "changedVsPrevious" | "parallelRiskTrial" | "issueAffected"> & {
    isChanged: number;
    changedVsPrevious: number;
    parallelRiskTrial: number;
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
            bi.transfer_request_id IS NOT NULL AND pv.release_mode = 'RISK'
              AND pv.status IN ('TRIAL','PENDING_FORMAL') AS parallelRiskTrial
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

export type TrialReadyVersion = {
  requestId: number;
  versionId: number;
  projectId: number;
  projectName: string;
  projectCode: string;
  packageId: number;
  packageName: string;
  packageCode: string;
  version: string;
  integrationStatus: string;
  versionStatus: string;
  changeSummary: string;
  archiveUrl: string;
  submittedByName: string | null;
  submittedAt: string;
  ownerName: string | null;
  softwareManagerName: string | null;
  softwareManagerId: number | null;
  releaseMode: "INTEGRATION" | "RISK";
  riskConclusion: string | null;
  batchId: number | null;
  batchCode: string | null;
  batchConclusion: string | null;
  batchTestSummary: string | null;
  batchReportUrl: string | null;
  versionProjectCount: number;
  riskProjectCount: number;
  riskAdmissionId: number | null;
  evidenceKey: string;
  ongoingTestCount: number;
};

const ONGOING_TEST_COUNT_SQL = `(
  SELECT COUNT(DISTINCT b.id) FROM batch_items bi
  JOIN integration_batches b ON b.id = bi.batch_id
  JOIN projects p ON p.id = b.project_id
  WHERE bi.package_version_id = pv.id AND bi.transfer_request_id IS NOT NULL
    AND b.status IN ('DRAFT','IN_TEST') AND p.status != 'ARCHIVED'
)`;

export function getTrialReadyVersions(
  projectIds: number[] | null = null,
  options: { requestId?: number; versionId?: number; includeUnregisteredRisk?: boolean } = {},
): TrialReadyVersion[] {
  if (projectIds?.length === 0) return [];
  const requestScope = options.requestId === undefined ? "" : "AND id = (SELECT package_version_id FROM version_transfer_requests WHERE id = ?)";
  const versionScope = options.versionId === undefined ? "" : "AND id = ?";
  const projectsScope = projectIds === null ? "" : "AND pr.id IN (SELECT value FROM json_each(?))";
  return all<TrialReadyVersion>(
    `WITH ${trialEligibilityCtes(`SELECT id, package_id FROM package_versions
       WHERE status IN ${TRIAL_PENDING_VERSION_STATUSES_SQL} ${requestScope} ${versionScope}`)}
     SELECT r.id AS requestId, pv.id AS versionId, pr.id AS projectId, pr.name AS projectName,
            pr.code AS projectCode, p.id AS packageId, p.name AS packageName, p.code AS packageCode,
            pv.version, r.status AS integrationStatus, pv.status AS versionStatus, pv.change_summary AS changeSummary,
            pv.archive_url AS archiveUrl, su.name AS submittedByName, pv.submitted_at AS submittedAt,
            o.name AS ownerName, sm.name AS softwareManagerName, pr.software_manager_id AS softwareManagerId,
            CASE WHEN q.riskProjectCount = 0 THEN 'INTEGRATION' ELSE 'RISK' END AS releaseMode,
            q.riskConclusion, q.riskAdmissionId, q.evidenceKey, q.versionProjectCount, q.riskProjectCount,
            b.id AS batchId, b.code AS batchCode, b.conclusion AS batchConclusion,
            b.test_summary AS batchTestSummary, b.test_report_url AS batchReportUrl,
            ${ONGOING_TEST_COUNT_SQL} AS ongoingTestCount
     FROM trial_eligibility q
     JOIN trial_project_evidence e ON e.versionId = q.versionId
     JOIN version_transfer_requests r ON r.id = e.requestId
     JOIN package_versions pv ON pv.id = q.versionId
     JOIN packages p ON p.id = pv.package_id
     JOIN projects pr ON pr.id = e.projectId
     LEFT JOIN users su ON su.id = pv.submitted_by
     LEFT JOIN users o ON o.id = p.owner_id
     LEFT JOIN users sm ON sm.id = pr.software_manager_id
     LEFT JOIN integration_batches b ON b.id = e.batchId
     WHERE q.unavailableRequestCount = 0 AND (q.releaseMode IS NOT NULL OR ?)
       ${options.requestId === undefined ? "" : "AND r.id = ?"} ${projectsScope}
     ORDER BY pr.sort_order, pv.submitted_at DESC, r.id DESC`,
    ...(options.requestId === undefined ? [] : [options.requestId]),
    ...(options.versionId === undefined ? [] : [options.versionId]),
    options.includeUnregisteredRisk ? 1 : 0,
    ...(options.requestId === undefined ? [] : [options.requestId]),
    ...(projectIds === null ? [] : [JSON.stringify(projectIds)]),
  );
}

export type TrialVersionRow = {
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
  batchId: number | null;
  batchCode: string | null;
  batchConclusion: string | null;
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
              b.id AS batchId, b.code AS batchCode, b.conclusion AS batchConclusion,
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
       LEFT JOIN integration_batches b ON b.id = (
         SELECT bi.batch_id FROM batch_items bi WHERE bi.transfer_request_id = r.id ORDER BY bi.id DESC LIMIT 1
       )
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
  request: {
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
    batchId: number | null;
    batchCode: string | null;
    batchConclusion: string | null;
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
  const approvedBarcodes = new Set<string>();
  const submittedBarcodes = new Set<string>();
  const passedBarcodes = new Set<string>();
  let unreviewedApprovedCount = 0;
  let failedBarcodeCount = 0;
  for (const flow of flows) {
    if (flow.status !== "PENDING" && flow.status !== "APPROVED") continue;
    for (const { barcode, result } of flow.barcodeResults) {
      submittedBarcodes.add(barcode);
      if (result === "FAIL") failedBarcodeCount += 1;
      if (flow.status !== "APPROVED") continue;
      approvedBarcodes.add(barcode);
      if (result === "UNREVIEWED") unreviewedApprovedCount += 1;
      if (result === "PASS") passedBarcodes.add(barcode);
    }
  }
  return {
    approvedCount: approvedBarcodes.size,
    passedBarcodeCount: passedBarcodes.size,
    unreviewedApprovedCount,
    failedBarcodeCount,
    submittedCount: submittedBarcodes.size,
    pendingCount: flows.filter((flow) => flow.status === "PENDING").length,
  };
}

export function getTrialDetail(requestId: number): TrialDetail | null {
  const request = one<TrialDetail["request"]>(
    `SELECT r.id, pr.id AS projectId, pr.name AS projectName, pr.code AS projectCode, pr.status AS projectStatus,
            p.id AS packageId, p.name AS packageName, p.code AS packageCode, p.owner_id AS packageOwnerId, pv.id AS versionId,
            pv.version, r.status, pv.status AS versionStatus, pv.change_summary AS changeSummary, pv.archive_url AS archiveUrl,
            r.integration_status AS integrationStatus, ${ONGOING_TEST_COUNT_SQL} AS ongoingTestCount,
            r.trial_form_no AS trialFormNo, pv.trial_review_minutes AS trialReviewMinutes,
            r.trial_released_at AS trialReleasedAt,
            r.release_mode AS releaseMode, r.risk_conclusion AS riskConclusion,
            pv.binding_mode AS bindingMode, pv.binding_reason AS bindingReason,
            p.trial_overdue_days AS trialOverdueDays,
            CASE WHEN r.trial_released_at IS NOT NULL
                 AND datetime(r.trial_released_at, '+' || p.trial_overdue_days || ' days') < datetime('now')
                 THEN 1 ELSE 0 END AS isOverdue,
            b.id AS batchId, b.code AS batchCode, b.conclusion AS batchConclusion,
            r.void_reason AS voidReason, pv.void_kind AS voidKind, r.voided_at AS voidedAt, o.name AS ownerName,
            sm.name AS softwareManagerName, pr.software_manager_id AS softwareManagerId
     FROM version_transfer_requests r
     JOIN package_versions pv ON pv.id = r.package_version_id
     JOIN packages p ON p.id = pv.package_id
     JOIN projects pr ON pr.id = r.project_id
     LEFT JOIN users o ON o.id = p.owner_id
     LEFT JOIN users sm ON sm.id = pr.software_manager_id
     LEFT JOIN integration_batches b ON b.id = (
       SELECT bi.batch_id FROM batch_items bi WHERE bi.transfer_request_id = r.id ORDER BY bi.id DESC LIMIT 1
     )
     WHERE r.id = ?`,
    requestId,
  );
  if (!request) return null;
  const requirements = all<Omit<BindingRequirementRow, "flows" | "approvedCount" | "submittedCount" | "pendingCount"
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
  ).map(({ barcodeRevision, barcodeConfirmation, ...requirement }) => {
    const flowRows = all<Omit<BindingFlowRow, "barcodes" | "barcodeResults">>(
      `SELECT f.id, f.flow_no AS flowNo, f.requirement_id AS requirementId, f.status,
              f.web_url AS webUrl, su.name AS submittedByName, f.submitted_by AS submittedById, f.submitted_at AS submittedAt,
              ap.name AS approverName, f.approver_id AS approverId, rv.name AS reviewedByName, f.reviewed_at AS reviewedAt,
              f.review_comment AS reviewComment, f.cancelled_at AS cancelledAt, f.cancel_reason AS cancelReason
       FROM binding_flows f
       LEFT JOIN users su ON su.id = f.submitted_by
       LEFT JOIN users ap ON ap.id = f.approver_id
       LEFT JOIN users rv ON rv.id = f.reviewed_by
       WHERE f.requirement_id = ? ORDER BY f.submitted_at DESC, f.id DESC`,
      requirement.id,
    );
    const barcodeRows = all<BindingBarcodeRow & { flowId: number }>(
      `SELECT b.flow_id AS flowId, b.id, b.barcode, b.validation_result AS result,
              b.failure_reason AS failureReason, b.validated_at AS validatedAt, validator.name AS validatedByName,
              b.failure_reason_at AS failureReasonAt, recorder.name AS failureReasonByName
       FROM binding_flow_barcodes b JOIN binding_flows f ON f.id = b.flow_id
       LEFT JOIN users validator ON validator.id = b.validated_by
       LEFT JOIN users recorder ON recorder.id = b.failure_reason_by
       WHERE f.requirement_id = ? ORDER BY b.id`,
      requirement.id,
    );
    const barcodeMap = new Map<number, BindingBarcodeRow[]>();
    for (const { flowId, ...row } of barcodeRows) {
      const list = barcodeMap.get(flowId) ?? [];
      list.push(row);
      barcodeMap.set(flowId, list);
    }
    const flows: BindingFlowRow[] = flowRows.map((flow) => {
      const barcodeResults = barcodeMap.get(flow.id) ?? [];
      return { ...flow, barcodeResults, barcodes: barcodeResults.map(({ barcode }) => barcode) };
    });
    const approverOptions = all<BindingRequirementRow["approverOptions"][number]>(
      `SELECT bra.user_id AS userId, u.name AS userName, u.employee_id AS userEmployeeId, u.is_active AS isActive
       FROM binding_requirement_approvers bra JOIN users u ON u.id = bra.user_id
       WHERE bra.requirement_id = ? ORDER BY bra.id`,
      requirement.id,
    );
    if (approverOptions.length === 0 && requirement.approverId && requirement.approverName) {
      const approver = one<BindingRequirementRow["approverOptions"][number]>(
        "SELECT id AS userId, name AS userName, employee_id AS userEmployeeId, is_active AS isActive FROM users WHERE id = ?",
        requirement.approverId,
      );
      if (approver) approverOptions.push(approver);
    }
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

export function getReadableTrialDetail(user: SessionUser, requestId: number): TrialDetail | null {
  const detail = getTrialDetail(requestId);
  if (!detail) return null;
  if (canAccessProjectPage(user, detail.request.projectId) || detail.request.packageOwnerId === user.id) return detail;
  const requirements = detail.requirements.flatMap((requirement) => {
    if (requirement.bindingOwnerId === user.id && requirement.pushedAt !== null) return [requirement];
    const flows = requirement.flows.filter((flow) => flow.approverId === user.id || flow.submittedById === user.id);
    return flows.length ? [{ ...requirement, ...bindingFlowCounts(flows), barcodeEvidenceKey: "", flows, approverOptions: [] }] : [];
  });
  return requirements.length ? { ...detail, requirements } : null;
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
  return filterByProject(
    all<PendingFormalVersion>(
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
       ORDER BY r.trial_released_at DESC, r.id DESC`,
      ...(versionId === undefined ? [] : [versionId]),
    ),
    projectIds,
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
  const managedProjectIds = getManagedProjectIds(user);
  const integrationProjectIds = getIntegrationManagedProjectIds(user.id);
  const managerScope = user.role === "ADMIN" ? null : managedProjectIds;
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
     WHERE f.submitted_by = ? AND pv.status = 'VOID' AND f.status IN ('PENDING','APPROVED')
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
    passedCount: number;
    unreviewedCount: number;
    failedCount: number;
    submittedCount: number;
    pendingFlowId: number | null;
  }>(
    `SELECT br.id AS requirementId, r.id AS requestId, p.name AS packageName, p.code AS packageCode, pv.version, pr.id AS projectId,
            p.owner_id AS packageOwnerId, br.binding_owner_id AS bindingOwnerId,
            pr.name AS projectName, n.name AS nodeName, br.required_count AS requiredCount,
            (SELECT COUNT(DISTINCT b.barcode) FROM binding_flow_barcodes b JOIN binding_flows f ON f.id = b.flow_id
             WHERE f.requirement_id = br.id AND f.status = 'APPROVED' AND b.validation_result = 'PASS') AS passedCount,
            (SELECT COUNT(*) FROM binding_flow_barcodes b JOIN binding_flows f ON f.id = b.flow_id
             WHERE f.requirement_id = br.id AND f.status = 'APPROVED' AND b.validation_result = 'UNREVIEWED') AS unreviewedCount,
            (SELECT COUNT(*) FROM binding_flow_barcodes b JOIN binding_flows f ON f.id = b.flow_id
             WHERE f.requirement_id = br.id AND f.status IN ('APPROVED','PENDING') AND b.validation_result = 'FAIL') AS failedCount,
            (SELECT COUNT(DISTINCT b.barcode) FROM binding_flow_barcodes b JOIN binding_flows f ON f.id = b.flow_id
             WHERE f.requirement_id = br.id AND f.status IN ('APPROVED','PENDING')) AS submittedCount,
            (SELECT f.id FROM binding_flows f WHERE f.requirement_id = br.id AND f.status = 'PENDING'
             ORDER BY f.submitted_at, f.id LIMIT 1) AS pendingFlowId
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
    user.id, user.id, user.role === "ADMIN" ? 1 : 0, JSON.stringify(managedProjectIds),
  );
  for (const task of bindingTasks) {
    const ready = task.passedCount >= task.requiredCount && task.unreviewedCount === 0;
    const canConfirm = task.packageOwnerId === user.id || managerScope === null || managedProjectIds.includes(task.projectId);
    const reviewAction = !canConfirm ? null : ready ? "确认节点通过" : task.unreviewedCount > 0 ? "判定设备条码"
      : task.failedCount > 0 ? "核对失败条码" : null;
    if (!reviewAction && (ready || task.bindingOwnerId !== user.id)) continue;
    const waitingApproval = !reviewAction && task.pendingFlowId !== null
      && task.submittedCount - task.failedCount >= task.requiredCount;
    const action = reviewAction ?? (waitingApproval ? "跟进电子流审批" : "提交绑定电子流");
    const linkTarget = waitingApproval ? `binding-flow-${task.pendingFlowId}` : `binding-node-${task.requirementId}`;
    const progress = `${task.projectName} / ${task.nodeName}，通过条码 ${task.passedCount}/${task.requiredCount}`
      + (task.unreviewedCount > 0 ? ` · ${task.unreviewedCount} 条待判定` : "")
      + (task.failedCount > 0 ? ` · ${task.failedCount} 条 FAIL` : "");
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
       AND f.status = 'PENDING' AND br.status IN ('PENDING','PASSED') AND br.pushed_at IS NOT NULL AND br.waived_at IS NULL
       AND r.status IN ('TRIAL','PENDING_FORMAL') AND pv.status IN ('TRIAL','PENDING_FORMAL')
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

  if (user.role === "ADMIN" || managedProjectIds.length > 0) {
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
      JSON.stringify(managedProjectIds),
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

  const readKeys = new Set(
    all<{ notificationKey: string }>(
      "SELECT notification_key AS notificationKey FROM notification_reads WHERE user_id = ?",
      user.id,
    ).map((row) => row.notificationKey),
  );
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
    batchId: number | null;
    batchCode: string | null;
    batchStatus: string | null;
    batchConclusion: string | null;
    batchTestSummary: string | null;
    batchReportUrl: string | null;
  }>;
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
            b.id AS batchId, b.code AS batchCode, b.status AS batchStatus,
            b.conclusion AS batchConclusion, b.test_summary AS batchTestSummary,
            b.test_report_url AS batchReportUrl
     FROM version_transfer_requests r
     JOIN projects pr ON pr.id = r.project_id
     LEFT JOIN integration_batches b ON b.id = (
       SELECT bi.batch_id FROM batch_items bi WHERE bi.transfer_request_id = r.id ORDER BY bi.id DESC LIMIT 1
     )
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
  const readableProjects = getProjectWorkflowProjectIds(user, true);
  const managedProjects = getManagedProjectIdsForUser(user.id);
  const hasProjectEvidence = (id: number) => readableProjects === null || readableProjects.includes(id);
  const hasBatchEvidence = (id: number, status: string | null) => status === "DRAFT"
    ? readableProjects === null || managedProjects.includes(id)
    : hasProjectEvidence(id);
  const readableBatches = batches.filter((batch) => hasBatchEvidence(batch.projectId, batch.status));
  if (projectId && requests.length === 0 && readableBatches.length === 0 && batches.length > 0) return null;
  const narrowRequests = readableProjects === null ? [] : getNarrowVersionRequestIds(user, versionId);
  const safeRequests = requests.filter(({ projectId, requestId }) => hasProjectEvidence(projectId) || narrowRequests.includes(requestId));
  if (projectId && requests.length > 0 && safeRequests.length === 0 && readableBatches.length === 0) return null;
  const projectedRequests = safeRequests.map((request) => hasBatchEvidence(request.projectId, request.batchStatus) ? request : {
    ...request,
    batchId: null,
    batchCode: null,
    batchStatus: null,
    batchConclusion: null,
    batchTestSummary: null,
    batchReportUrl: null,
  });
  const details = safeRequests
    .map((request) => getReadableTrialDetail(user, request.requestId))
    .filter((detail): detail is TrialDetail => detail !== null);
  return { version, requests: projectedRequests, batches: readableBatches, details };
}

export type ProjectVersionRow = {
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
  batchId: number | null;
  batchCode: string | null;
  batchConclusion: string | null;
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
            b.id AS batchId, b.code AS batchCode,
            b.conclusion AS batchConclusion
     FROM version_transfer_requests r
     JOIN package_versions pv ON pv.id = r.package_version_id
     JOIN packages p ON p.id = pv.package_id
     LEFT JOIN integration_batches b ON b.id = (
       SELECT bi.batch_id FROM batch_items bi WHERE bi.transfer_request_id = r.id ORDER BY bi.id DESC LIMIT 1
     )
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
  const pageCount = Math.max(1, Math.ceil(total / state.pageSize));
  const page = Math.min(state.page, pageCount);
  const direction = state.direction === "asc" ? "ASC" : "DESC";
  const rows = all<TraceVersionRow>(
    `${traceVersionFields} ${traceVersionsFrom} WHERE ${where}
     ORDER BY ${traceSortSql[state.sort]} ${direction}, pv.id DESC LIMIT ? OFFSET ?`,
    ...params, state.pageSize, (page - 1) * state.pageSize,
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
