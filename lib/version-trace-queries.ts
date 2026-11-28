import "server-only";

import {
  canReadBatchEvidence,
  getBatchEvidenceReadScope,
  getNarrowVersionRequestIds,
  getReadableLinkedBatchEvidence,
  type LinkedBatchEvidence,
} from "./access";
import type { TrialDetail, TrialDetailReader } from "./binding-queries";
import { all, one } from "./db";
import { getPageWindow } from "./list-pagination";
import { packageCodeSql } from "./package-identity";
import { LATEST_TRANSFER_REQUEST_BATCH_ID_SQL } from "./transfer-requests";
import { TRIAL_RELEASE_OVERDUE_SQL } from "./trial-readiness";
import { STANDALONE_VERSION_HISTORY_IN_PROJECT_SQL } from "./version-scope";
import type { TraceListState } from "./version-trace-list";

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

export function getVersionTrace(
  reader: TrialDetailReader,
  versionId: number,
  projectId: number | undefined,
  readableIds: readonly number[] | null,
): VersionTrace | null {
  const { user } = reader;
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
  // Exclude the version index here to preserve the existing join choices for tied batch times.
  const batches = all<VersionTrace["batches"][number]>(
    `SELECT DISTINCT b.id, b.code, pr.id AS projectId, pr.name AS projectName, b.status,
            b.conclusion, b.created_at AS createdAt, b.sent_at AS sentAt, b.completed_at AS completedAt,
            b.test_summary AS testSummary, b.test_report_url AS testReportUrl
     FROM batch_items bi
     JOIN integration_batches b ON b.id = bi.batch_id
     JOIN projects pr ON pr.id = b.project_id
     WHERE +bi.package_version_id = ? AND (? IS NULL OR pr.id = ?)
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
    const detail = reader.getReadableTrialDetail(requestId);
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
            CASE WHEN pv.status NOT IN ('FORMAL','VOID') AND ${TRIAL_RELEASE_OVERDUE_SQL}
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
