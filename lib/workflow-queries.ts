import { all, one } from "./db";
import { getIntegrationManagedProjectIds } from "./access";
import type { SessionUser } from "./types";

export type ProjectOption = { id: number; name: string; code: string; status: string };

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

export function getWorkflowProjectScope(user: SessionUser): number[] | null {
  if (user.role === "ADMIN") return null;
  if (user.role === "SOFTWARE_MANAGER") return getManagedProjectIds(user);
  const integrationProjects = getIntegrationManagedProjectIds(user.id);
  if (integrationProjects.length > 0) return integrationProjects;
  return null;
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
};

export type PendingTransferGroup = {
  projectId: number;
  projectName: string;
  projectCode: string;
  items: PendingTransferItem[];
};

export function getPendingTransferGroups(projectIds: number[] | null = null): PendingTransferGroup[] {
  const rows = all<PendingTransferItem & { projectId: number; projectName: string; projectCode: string }>(
    `SELECT r.id AS requestId, pv.id AS versionId, p.id AS packageId, p.name AS packageName,
            p.code AS packageCode, pv.version, pv.change_summary AS changeSummary, pv.archive_url AS archiveUrl,
            su.name AS submittedByName, pv.submitted_by AS submittedById, pv.status AS versionStatus,
            pv.submitted_at AS submittedAt, o.name AS ownerName,
            pr.id AS projectId, pr.name AS projectName, pr.code AS projectCode
     FROM version_transfer_requests r
     JOIN package_versions pv ON pv.id = r.package_version_id
     JOIN packages p ON p.id = pv.package_id
     JOIN projects pr ON pr.id = r.project_id
     LEFT JOIN users su ON su.id = pv.submitted_by
     LEFT JOIN users o ON o.id = p.owner_id
     WHERE r.status = 'PENDING'
     ORDER BY pr.sort_order, pr.id, pv.submitted_at DESC`,
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
  previousTestVersionId: number | null;
  requestId: number | null;
  formalVersion: string | null;
  currentTrialVersions: string[];
  previousTestVersion: string | null;
  changedVsPrevious: boolean;
  changeSummary: string;
  archiveUrl: string;
};

export function getBatchCandidatesForProject(projectId: number): BatchCandidatePackage[] {
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
     ORDER BY p.name`,
    projectId,
  );
  const projectRequests = all<{ requestId: number; versionId: number; status: string }>(
    `SELECT r.id AS requestId, r.package_version_id AS versionId, r.status
     FROM version_transfer_requests r WHERE r.project_id = ?`,
    projectId,
  );
  const requestByVersion = new Map(projectRequests.map((request) => [request.versionId, request]));
  return packages.map((pkg) => {
    const versionRows = all<{
      id: number;
      version: string;
      status: string;
      archiveUrl: string;
      changeSummary: string;
      submittedAt: string;
    }>(
      `SELECT id, version, status, archive_url AS archiveUrl, change_summary AS changeSummary,
              submitted_at AS submittedAt
       FROM package_versions WHERE package_id = ?
       ORDER BY submitted_at DESC, id DESC`,
      pkg.packageId,
    );
    const versions = versionRows.map((version) => ({
      id: version.id,
      version: version.version,
      status: version.status,
      requestStatus: requestByVersion.get(version.id)?.status ?? null,
    }));
    const pending = versions.find((version) => version.requestStatus === "PENDING") ?? null;
    const formal = versions.find((version) => version.status === "FORMAL") ?? null;
    const trialVersions = versions.filter((version) => version.status === "TRIAL" || version.status === "PENDING_FORMAL");
    const previous = one<{ versionId: number; version: string }>(
      `SELECT bi.package_version_id AS versionId, bi.version FROM batch_items bi
       JOIN integration_batches b ON b.id = bi.batch_id
       WHERE b.project_id = ? AND bi.package_id = ? AND b.status IN ('IN_TEST','COMPLETED')
       ORDER BY COALESCE(b.completed_at, b.sent_at) DESC, bi.id DESC LIMIT 1`,
      projectId,
      pkg.packageId,
    );
    const previousVersion = previous ? versions.find((version) => version.id === previous.versionId) ?? null : null;
    const previousSafe = previousVersion && previousVersion.status !== "VOID" && previousVersion.requestStatus !== "VOID" ? previousVersion : null;
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
      previousTestVersionId: previousVersion?.id ?? null,
      requestId: selectedRequest?.status === "PENDING" ? selectedRequest.requestId : null,
      formalVersion: formal?.version ?? null,
      currentTrialVersions: trialVersions.map((version) => version.version),
      previousTestVersion: previousVersion?.version ?? null,
      changedVsPrevious: previousVersion ? previousVersion.version !== defaultVersion.version : true,
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

export function getBatches(limit = 80, projectIds: number[] | null = null): BatchSummaryRow[] {
  const rows = all<Omit<BatchSummaryRow, "itemCount" | "changedCount"> & { itemCount: number; changedCount: number }>(
    `SELECT b.id, b.code, b.title, b.status, b.project_id AS projectId,
            pr.name AS projectName, pr.code AS projectCode, pr.software_manager_id AS softwareManagerId, b.conclusion,
            b.issue_attribution AS issueAttribution, b.created_at AS createdAt,
            b.sent_at AS sentAt, b.completed_at AS completedAt, b.terminated_at AS terminatedAt,
            b.terminate_reason AS terminateReason, b.test_summary AS testSummary,
            b.test_report_url AS testReportUrl, b.test_report_name AS testReportName,
            b.test_report_file_id AS testReportFileId, c.name AS createdByName,
            (SELECT COUNT(*) FROM batch_items bi WHERE bi.batch_id = b.id) AS itemCount,
            (SELECT COUNT(*) FROM batch_items bi WHERE bi.batch_id = b.id AND bi.is_changed = 1) AS changedCount
     FROM integration_batches b
     JOIN projects pr ON pr.id = b.project_id
     LEFT JOIN users c ON c.id = b.created_by
     ORDER BY COALESCE(b.sent_at, b.created_at) DESC, b.id DESC LIMIT ?`,
    limit,
  ).map((batch) => ({
    ...batch,
    itemCount: Number(batch.itemCount),
    changedCount: Number(batch.changedCount),
  }));
  return filterByProject(rows, projectIds);
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
  formalVersion: string | null;
  trialVersions: string | null;
  previousTestVersion: string | null;
  changedVsPrevious: boolean;
  ownerName: string | null;
};

export type BatchProgressNote = {
  id: number;
  content: string;
  createdAt: string;
  authorName: string | null;
};

export type BatchDetailRow = { batch: BatchSummaryRow; items: BatchItemRow[]; progressNotes: BatchProgressNote[] };

export function getBatchDetail(batchId: number): BatchDetailRow | null {
  const batch = getBatches(500).find((item) => item.id === batchId);
  if (!batch) return null;
  const items = all<Omit<BatchItemRow, "isChanged" | "changedVsPrevious"> & { isChanged: number; changedVsPrevious: number }>(
    `SELECT bi.id, p.id AS packageId, p.name AS packageName, p.code AS packageCode,
            bi.package_version_id AS versionId, bi.version, bi.archive_url AS archiveUrl,
            bi.change_summary AS changeSummary, bi.is_changed AS isChanged,
            bi.transfer_request_id AS transferRequestId, r.status AS requestStatus,
            bi.formal_version AS formalVersion, bi.trial_versions AS trialVersions,
            bi.previous_test_version AS previousTestVersion, bi.changed_vs_previous AS changedVsPrevious,
            u.name AS ownerName
     FROM batch_items bi
     JOIN packages p ON p.id = bi.package_id
     LEFT JOIN version_transfer_requests r ON r.id = bi.transfer_request_id
     LEFT JOIN users u ON u.id = p.owner_id
     WHERE bi.batch_id = ?
     ORDER BY bi.is_changed DESC, p.name`,
    batchId,
  ).map((item) => ({
    ...item,
    isChanged: Boolean(item.isChanged),
    changedVsPrevious: Boolean(item.changedVsPrevious),
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
};

export function getTrialReadyVersions(projectIds: number[] | null = null): TrialReadyVersion[] {
  return filterByProject(
    all<TrialReadyVersion>(
      `SELECT r.id AS requestId, pv.id AS versionId, pr.id AS projectId, pr.name AS projectName,
              pr.code AS projectCode, p.id AS packageId, p.name AS packageName, p.code AS packageCode,
              pv.version, r.status AS integrationStatus, pv.change_summary AS changeSummary,
              pv.archive_url AS archiveUrl, su.name AS submittedByName, pv.submitted_at AS submittedAt,
              o.name AS ownerName, sm.name AS softwareManagerName, pr.software_manager_id AS softwareManagerId,
              r.release_mode AS releaseMode, r.risk_conclusion AS riskConclusion,
              b.id AS batchId, b.code AS batchCode, b.conclusion AS batchConclusion,
              b.test_summary AS batchTestSummary, b.test_report_url AS batchReportUrl
       FROM version_transfer_requests r
       JOIN package_versions pv ON pv.id = r.package_version_id
       JOIN packages p ON p.id = pv.package_id
       JOIN projects pr ON pr.id = r.project_id
       LEFT JOIN users su ON su.id = pv.submitted_by
       LEFT JOIN users o ON o.id = p.owner_id
       LEFT JOIN users sm ON sm.id = pr.software_manager_id
       LEFT JOIN integration_batches b ON b.id = (
         SELECT bi.batch_id FROM batch_items bi WHERE bi.transfer_request_id = r.id ORDER BY bi.id DESC LIMIT 1
       )
       WHERE r.status IN ('PASSED','FAILED','BLOCKED')
       ORDER BY pr.sort_order, pv.submitted_at DESC, r.id DESC`,
    ),
    projectIds,
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
  archiveUrl: string;
  changeSummary: string;
  ownerName: string | null;
  softwareManagerName: string | null;
  softwareManagerId: number | null;
  releaseMode: "INTEGRATION" | "RISK";
  riskConclusion: string | null;
  batchId: number | null;
  batchCode: string | null;
  batchConclusion: string | null;
  requirementTotal: number;
  requirementPassed: number;
  pendingFlowCount: number;
};

export function getTrialVersions(projectIds: number[] | null = null): TrialVersionRow[] {
  return filterByProject(
    all<TrialVersionRow>(
      `SELECT r.id AS requestId, pv.id AS versionId, pr.id AS projectId, pr.name AS projectName,
              pr.code AS projectCode, p.id AS packageId, p.name AS packageName, p.code AS packageCode,
              pv.version, r.trial_form_no AS trialFormNo, r.trial_released_at AS trialReleasedAt,
              pv.archive_url AS archiveUrl, pv.change_summary AS changeSummary, o.name AS ownerName,
              sm.name AS softwareManagerName, pr.software_manager_id AS softwareManagerId,
              r.release_mode AS releaseMode, r.risk_conclusion AS riskConclusion,
              b.id AS batchId, b.code AS batchCode, b.conclusion AS batchConclusion,
              (SELECT COUNT(*) FROM binding_requirements br WHERE br.request_id = r.id) AS requirementTotal,
              (SELECT COUNT(*) FROM binding_requirements br WHERE br.request_id = r.id AND br.status = 'PASSED') AS requirementPassed,
              (SELECT COUNT(*) FROM binding_flows f WHERE f.requirement_id IN (SELECT id FROM binding_requirements WHERE request_id = r.id) AND f.status = 'PENDING') AS pendingFlowCount
       FROM version_transfer_requests r
       JOIN package_versions pv ON pv.id = r.package_version_id
       JOIN packages p ON p.id = pv.package_id
       JOIN projects pr ON pr.id = r.project_id
       LEFT JOIN users o ON o.id = p.owner_id
       LEFT JOIN users sm ON sm.id = pr.software_manager_id
       LEFT JOIN integration_batches b ON b.id = (
         SELECT bi.batch_id FROM batch_items bi WHERE bi.transfer_request_id = r.id ORDER BY bi.id DESC LIMIT 1
       )
       WHERE r.status = 'TRIAL'
       ORDER BY r.trial_released_at DESC, r.id DESC`,
    ),
    projectIds,
  ).map((version) => ({
    ...version,
    requirementTotal: Number(version.requirementTotal),
    requirementPassed: Number(version.requirementPassed),
    pendingFlowCount: Number(version.pendingFlowCount),
  }));
}

export type BindingFlowRow = {
  id: number;
  flowNo: string;
  requirementId: number;
  barcodes: string[];
  webUrl: string | null;
  status: string;
  submittedByName: string | null;
  submittedById: number | null;
  submittedAt: string;
  approverName: string | null;
  approverId: number | null;
  reviewedAt: string | null;
  reviewComment: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
};

export type BindingRequirementRow = {
  id: number;
  projectId: number;
  projectName: string;
  nodeId: number;
  nodeName: string;
  requiredCount: number;
  approvedCount: number;
  pendingCount: number;
  status: string;
  bindingOwnerId: number | null;
  bindingOwnerName: string | null;
  approverId: number | null;
  approverName: string | null;
  approverOptions: Array<{ userId: number; userName: string; userEmployeeId: string }>;
  flows: BindingFlowRow[];
};

export type TrialDetail = {
  request: {
    id: number;
    projectId: number;
    projectName: string;
    projectCode: string;
    packageId: number;
    packageName: string;
    packageCode: string;
    versionId: number;
    version: string;
    status: string;
    changeSummary: string;
    archiveUrl: string;
    trialFormNo: string | null;
    trialReleasedAt: string | null;
    releaseMode: "INTEGRATION" | "RISK";
    riskConclusion: string | null;
    batchId: number | null;
    batchCode: string | null;
    batchConclusion: string | null;
    voidReason: string | null;
    voidedAt: string | null;
    ownerName: string | null;
    softwareManagerName: string | null;
    softwareManagerId: number | null;
  };
  requirements: BindingRequirementRow[];
};

export function getTrialDetail(requestId: number): TrialDetail | null {
  const request = one<TrialDetail["request"]>(
    `SELECT r.id, pr.id AS projectId, pr.name AS projectName, pr.code AS projectCode,
            p.id AS packageId, p.name AS packageName, p.code AS packageCode, pv.id AS versionId,
            pv.version, r.status, pv.change_summary AS changeSummary, pv.archive_url AS archiveUrl,
            r.trial_form_no AS trialFormNo, r.trial_released_at AS trialReleasedAt,
            r.release_mode AS releaseMode, r.risk_conclusion AS riskConclusion,
            b.id AS batchId, b.code AS batchCode, b.conclusion AS batchConclusion,
            r.void_reason AS voidReason, r.voided_at AS voidedAt, o.name AS ownerName,
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
  const requirements = all<Omit<BindingRequirementRow, "flows" | "approvedCount" | "pendingCount">>(
    `SELECT br.id, br.project_id AS projectId, pr.name AS projectName, br.node_id AS nodeId,
            n.name AS nodeName, br.required_count AS requiredCount, br.status,
            br.binding_owner_id AS bindingOwnerId, bo.name AS bindingOwnerName,
            br.approver_id AS approverId, ba.name AS approverName
     FROM binding_requirements br
     JOIN projects pr ON pr.id = br.project_id
     JOIN project_nodes n ON n.id = br.node_id
     LEFT JOIN users bo ON bo.id = br.binding_owner_id
     LEFT JOIN users ba ON ba.id = br.approver_id
     WHERE br.request_id = ? ORDER BY n.sort_order`,
    requestId,
  ).map((requirement) => {
    const flowRows = all<Omit<BindingFlowRow, "barcodes">>(
      `SELECT f.id, f.flow_no AS flowNo, f.requirement_id AS requirementId, f.status,
              f.web_url AS webUrl, su.name AS submittedByName, f.submitted_by AS submittedById, f.submitted_at AS submittedAt,
              ap.name AS approverName, f.approver_id AS approverId, f.reviewed_at AS reviewedAt,
              f.review_comment AS reviewComment, f.cancelled_at AS cancelledAt, f.cancel_reason AS cancelReason
       FROM binding_flows f
       LEFT JOIN users su ON su.id = f.submitted_by
       LEFT JOIN users ap ON ap.id = f.approver_id
       WHERE f.requirement_id = ? ORDER BY f.submitted_at DESC, f.id DESC`,
      requirement.id,
    );
    const barcodeRows = all<{ flowId: number; barcode: string }>(
      `SELECT b.flow_id AS flowId, b.barcode FROM binding_flow_barcodes b
       JOIN binding_flows f ON f.id = b.flow_id WHERE f.requirement_id = ? ORDER BY b.id`,
      requirement.id,
    );
    const barcodeMap = new Map<number, string[]>();
    for (const row of barcodeRows) {
      const list = barcodeMap.get(row.flowId) ?? [];
      list.push(row.barcode);
      barcodeMap.set(row.flowId, list);
    }
    const flows: BindingFlowRow[] = flowRows.map((flow) => ({ ...flow, barcodes: barcodeMap.get(flow.id) ?? [] }));
    const approverOptions = all<{ userId: number; userName: string; userEmployeeId: string }>(
      `SELECT bra.user_id AS userId, u.name AS userName, u.employee_id AS userEmployeeId
       FROM binding_requirement_approvers bra JOIN users u ON u.id = bra.user_id
       WHERE bra.requirement_id = ? ORDER BY bra.id`,
      requirement.id,
    );
    if (approverOptions.length === 0 && requirement.approverId && requirement.approverName) {
      approverOptions.push({ userId: requirement.approverId, userName: requirement.approverName, userEmployeeId: "" });
    }
    const approvedCount = flows.filter((flow) => flow.status === "APPROVED").reduce((total, flow) => total + flow.barcodes.length, 0);
    return {
      ...requirement,
      approvedCount,
      pendingCount: flows.filter((flow) => flow.status === "PENDING").length,
      approverOptions,
      flows,
    };
  });
  return { request, requirements };
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
  ownerName: string | null;
  softwareManagerName: string | null;
  softwareManagerId: number | null;
  requirementTotal: number;
  requirementPassed: number;
};

export function getPendingFormalVersions(projectIds: number[] | null = null): PendingFormalVersion[] {
  return filterByProject(
    all<PendingFormalVersion>(
      `SELECT r.id AS requestId, pv.id AS versionId, pr.id AS projectId, pr.name AS projectName,
              pr.code AS projectCode, p.id AS packageId, p.name AS packageName, p.code AS packageCode,
              pv.version, pv.change_summary AS changeSummary, pv.archive_url AS archiveUrl,
              r.trial_form_no AS trialFormNo, r.trial_released_at AS trialReleasedAt,
              o.name AS ownerName, sm.name AS softwareManagerName, pr.software_manager_id AS softwareManagerId,
              (SELECT COUNT(*) FROM binding_requirements br WHERE br.request_id = r.id) AS requirementTotal,
              (SELECT COUNT(*) FROM binding_requirements br WHERE br.request_id = r.id AND br.status = 'PASSED') AS requirementPassed
       FROM version_transfer_requests r
       JOIN package_versions pv ON pv.id = r.package_version_id
       JOIN packages p ON p.id = pv.package_id
       JOIN projects pr ON pr.id = r.project_id
       LEFT JOIN users o ON o.id = p.owner_id
       LEFT JOIN users sm ON sm.id = pr.software_manager_id
       WHERE r.status = 'PENDING_FORMAL'
       ORDER BY r.trial_released_at DESC, r.id DESC`,
    ),
    projectIds,
  ).map((version) => ({
    ...version,
    requirementTotal: Number(version.requirementTotal),
    requirementPassed: Number(version.requirementPassed),
  }));
}

// ---------- Personal workbench ----------

export type PersonalTask = {
  key: string;
  title: string;
  description: string;
  href: string;
  category: "approve" | "bind" | "test" | "manage" | "alert";
  meta?: string;
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
  version: string;
  status: string;
  updatedAt: string;
  projectSummary: string;
};

export type MyBindingFlow = {
  id: number;
  flowNo: string;
  packageName: string;
  version: string;
  projectName: string;
  nodeName: string;
  barcodes: string[];
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
    packageId: number;
    packageName: string;
    version: string;
    projectName: string;
    status: string;
    updatedAt: string;
  }>(
    `SELECT r.id AS requestId, p.id AS packageId, p.name AS packageName, pv.version,
            pr.name AS projectName, r.status, r.updated_at AS updatedAt
     FROM version_transfer_requests r
     JOIN package_versions pv ON pv.id = r.package_version_id
     JOIN packages p ON p.id = pv.package_id
     JOIN projects pr ON pr.id = r.project_id
     WHERE pv.submitted_by = ? AND r.status IN ('FAILED','BLOCKED')
     ORDER BY r.updated_at DESC`,
    user.id,
  );
  for (const failure of failedTests) {
    alerts.push({
      key: `failed-${failure.requestId}`,
      title: `${failure.packageName} ${failure.version} 在 ${failure.projectName} 测试异常`,
      description: `本项目集成测试结论为“${failure.status === "FAILED" ? "不通过" : "无法验证"}”，请关注后续处理。`,
      href: `/packages?open=${failure.packageId}`,
      tone: failure.status === "FAILED" ? "danger" : "warning",
      at: failure.updatedAt,
    });
  }

  const rejectedFlows = all<{
    id: number;
    flowNo: string;
    packageName: string;
    version: string;
    requestId: number;
    projectName: string;
    nodeName: string;
    reviewComment: string | null;
    reviewedAt: string | null;
  }>(
    `SELECT f.id, f.flow_no AS flowNo, p.name AS packageName, pv.version, r.id AS requestId,
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
      description: `${flow.packageName} ${flow.version} · ${flow.projectName}/${flow.nodeName}${flow.reviewComment ? `：${flow.reviewComment}` : ""}`,
      href: `/trial/${flow.requestId}`,
      tone: "danger",
      at: flow.reviewedAt ?? undefined,
    });
  }

  const voidFlows = all<{
    id: number;
    flowNo: string;
    packageName: string;
    version: string;
    requestId: number;
    projectName: string;
    nodeName: string;
    voidReason: string | null;
  }>(
    `SELECT f.id, f.flow_no AS flowNo, p.name AS packageName, pv.version, r.id AS requestId,
            pr.name AS projectName, n.name AS nodeName, r.void_reason AS voidReason
     FROM binding_flows f
     JOIN binding_requirements br ON br.id = f.requirement_id
     JOIN version_transfer_requests r ON r.id = br.request_id
     JOIN package_versions pv ON pv.id = f.package_version_id
     JOIN packages p ON p.id = pv.package_id
     JOIN projects pr ON pr.id = f.project_id
     JOIN project_nodes n ON n.id = f.node_id
     WHERE f.submitted_by = ? AND f.status = 'PENDING' AND r.status = 'VOID'
     ORDER BY f.submitted_at DESC`,
    user.id,
  );
  for (const flow of voidFlows) {
    alerts.push({
      key: `void-flow-${flow.id}`,
      title: "试制版本已作废，请撤销绑定电子流",
      description: `${flow.packageName} ${flow.version} · ${flow.projectName}/${flow.nodeName} 已作废，请撤销电子流 ${flow.flowNo}。${flow.voidReason ? `原因：${flow.voidReason}` : ""}`,
      href: `/trial/${flow.requestId}`,
      tone: "danger",
    });
  }

  const bindingTasks = all<{
    requirementId: number;
    requestId: number;
    packageName: string;
    version: string;
    projectName: string;
    nodeName: string;
    requiredCount: number;
    approvedCount: number;
  }>(
    `SELECT br.id AS requirementId, r.id AS requestId, p.name AS packageName, pv.version,
            pr.name AS projectName, n.name AS nodeName, br.required_count AS requiredCount,
            (SELECT COUNT(*) FROM binding_flow_barcodes b JOIN binding_flows f ON f.id = b.flow_id
             WHERE f.requirement_id = br.id AND f.status = 'APPROVED') AS approvedCount
     FROM binding_requirements br
     JOIN version_transfer_requests r ON r.id = br.request_id
     JOIN package_versions pv ON pv.id = br.package_version_id
     JOIN packages p ON p.id = pv.package_id
     JOIN projects pr ON pr.id = br.project_id
     JOIN project_nodes n ON n.id = br.node_id
     WHERE br.binding_owner_id = ? AND r.status = 'TRIAL' AND br.status = 'PENDING'
     ORDER BY pr.sort_order, n.sort_order`,
    user.id,
  );
  for (const task of bindingTasks) {
    tasks.push({
      key: `binding-${task.requirementId}`,
      title: `提交绑定电子流：${task.packageName} ${task.version}`,
      description: `${task.projectName} / ${task.nodeName}，已通过条码 ${task.approvedCount}/${task.requiredCount}`,
      href: `/trial/${task.requestId}`,
      category: "bind",
      meta: "待绑定",
    });
  }

  const approvals = all<{
    id: number;
    flowNo: string;
    packageName: string;
    version: string;
    requestId: number;
    projectName: string;
    nodeName: string;
    submittedByName: string | null;
    barcodeCount: number;
  }>(
    `SELECT f.id, f.flow_no AS flowNo, p.name AS packageName, pv.version, r.id AS requestId,
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
     WHERE f.approver_id = ? AND f.status = 'PENDING' AND r.status = 'TRIAL'
     ORDER BY f.submitted_at`,
    user.id,
  );
  for (const approval of approvals) {
    tasks.push({
      key: `approval-${approval.id}`,
      title: `审批绑定电子流：${approval.flowNo}`,
      description: `${approval.packageName} ${approval.version} · ${approval.projectName}/${approval.nodeName} · ${approval.barcodeCount} 个设备条码`,
      href: `/trial/${approval.requestId}`,
      category: "approve",
      meta: approval.submittedByName ? `提交人 ${approval.submittedByName}` : "待审批",
    });
  }

  if (user.role === "ADMIN" || user.role === "SOFTWARE_MANAGER") {
    const pendingGroups = getPendingTransferGroups(managerScope);
    for (const group of pendingGroups) {
      tasks.push({
        key: `transfer-${group.projectId}`,
        title: `${group.projectName} 有 ${group.items.length} 个待组织转测申请`,
        description: group.items.map((item) => `${item.packageName} ${item.version}`).join("、"),
        href: `/integration/new?project=${group.projectId}`,
        category: "test",
        meta: "待组织整套配套",
      });
    }
    const batches = getBatches(100, managerScope).filter((batch) => batch.status === "IN_TEST");
    for (const batch of batches) {
      tasks.push({
        key: `batch-manager-${batch.id}`,
        title: `${batch.code} ${batch.projectName} 集成测试进行中`,
        description: `${batch.changedCount} 个变更包 · 等待本项目集成测试负责人提交结论`,
        href: `/integration/${batch.id}`,
        category: "test",
        meta: "跟踪测试进度",
      });
    }
    const ready = getTrialReadyVersions(managerScope);
    if (ready.length > 0) {
      tasks.push({
        key: "trial-ready",
        title: `${ready.length} 个本项目版本已完成集成测试，待发布试制`,
        description: ready.slice(0, 4).map((version) => `${version.projectName} · ${version.packageName} ${version.version}`).join("、"),
        href: "/trial",
        category: "manage",
        meta: "发布试制",
      });
    }
    const pendingFormal = getPendingFormalVersions(managerScope);
    if (pendingFormal.length > 0) {
      tasks.push({
        key: "formal-ready",
        title: `${pendingFormal.length} 个本项目版本绑定验证完成，待转正`,
        description: pendingFormal.slice(0, 4).map((version) => `${version.projectName} · ${version.packageName} ${version.version}`).join("、"),
        href: "/formal",
        category: "manage",
        meta: "提交转正电子流",
      });
    }
  }

  if (integrationProjectIds.length > 0 || user.role === "ADMIN") {
    const testBatches = getBatches(100, integrationScope).filter((batch) => batch.status === "IN_TEST");
    for (const batch of testBatches) {
      tasks.push({
        key: `integration-test-${batch.id}`,
        title: `${batch.projectName} 集成测试待提交结论`,
        description: `${batch.code} · ${batch.changedCount} 个变更包，提交测试结论并上传验证报告`,
        href: `/integration/${batch.id}`,
        category: "test",
        meta: "提交测试结论",
      });
    }
  }

  const myVersions = all<MyVersion>(
    `SELECT pv.id, p.id AS packageId, p.name AS packageName, pv.version, pv.status, pv.updated_at AS updatedAt,
            COALESCE((
              SELECT GROUP_CONCAT(pr.name || '·' || CASE r.status
                WHEN 'PENDING' THEN '待测试' WHEN 'IN_TEST' THEN '测试中'
                WHEN 'PASSED' THEN '可发试制' WHEN 'FAILED' THEN '不通过'
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

  const myFlowRows = all<Omit<MyBindingFlow, "barcodes">>(
    `SELECT f.id, f.flow_no AS flowNo, p.name AS packageName, pv.version,
            pr.name AS projectName, n.name AS nodeName, f.status,
            f.review_comment AS reviewComment, f.reviewed_at AS reviewedAt, r.id AS requestId
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
  const myFlowBarcodes = all<{ flowId: number; barcode: string }>(
    `SELECT b.flow_id AS flowId, b.barcode FROM binding_flow_barcodes b
     JOIN binding_flows f ON f.id = b.flow_id
     WHERE f.submitted_by = ? ORDER BY b.id`,
    user.id,
  );
  const myBarcodeMap = new Map<number, string[]>();
  for (const row of myFlowBarcodes) {
    const list = myBarcodeMap.get(row.flowId) ?? [];
    list.push(row.barcode);
    myBarcodeMap.set(row.flowId, list);
  }
  const myBindingFlows: MyBindingFlow[] = myFlowRows.map((flow) => ({
    ...flow,
    barcodes: myBarcodeMap.get(flow.id) ?? [],
  }));
  for (const flow of myBindingFlows) {
    if (flow.status === "APPROVED" || flow.status === "REJECTED") {
      notifications.push({
        key: `flow-notice-${flow.id}`,
        title: `绑定电子流 ${flow.flowNo} ${flow.status === "APPROVED" ? "已通过" : "已驳回"}`,
        description: `${flow.packageName} ${flow.version} · ${flow.projectName}/${flow.nodeName}${flow.reviewComment ? `：${flow.reviewComment}` : ""}`,
        href: `/trial/${flow.requestId}`,
        tone: flow.status === "APPROVED" ? "success" : "danger",
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
  const unreadAlerts = alerts.filter((alert) => !readKeys.has(alert.key));
  const unreadNotifications = notifications.filter((notification) => !readKeys.has(notification.key));

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
      myActiveVersions: myVersions.filter((version) => !["FORMAL", "VOID"].includes(version.status)).length,
    },
  };
}

export function getPersonalTaskCount(user: SessionUser): number {
  const data = getPersonalDashboard(user);
  return data.counts.tasks + data.counts.alerts;
}

export function getWorkflowSidebarCounts(user: SessionUser) {
  const scope = getWorkflowProjectScope(user);
  const pendingGroups = getPendingTransferGroups(scope);
  const pendingSubmissions = pendingGroups.reduce((total, group) => total + group.items.length, 0);
  const batches = getBatches(100, scope);
  const activeBatches = batches.filter((batch) => batch.status === "IN_TEST").length;
  const trialVersions = getTrialVersions(scope).length;
  const pendingTrial = getTrialReadyVersions(scope).length;
  const pendingFormal = getPendingFormalVersions(scope).length;
  return { pendingSubmissions, pendingGroups: pendingGroups.length, activeBatches, trialQueue: trialVersions + pendingTrial, pendingFormal };
}
