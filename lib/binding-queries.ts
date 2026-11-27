import "server-only";

import { getProjectWorkflowProjectIds, type LinkedBatchEvidence } from "./access";
import { bindingBarcodeEvidenceKey, summarizeBindingBarcodes, type BindingBarcodeResult } from "./binding-barcode-results";
import { all, db, one } from "./db";
import { LATEST_TRANSFER_REQUEST_BATCH_ID_SQL } from "./transfer-requests";
import { ACTIVE_INTEGRATION_BATCH_COUNT_SQL, getPendingBindingFlowCounts, TRIAL_RELEASE_OVERDUE_SQL } from "./trial-readiness";
import type { SessionUser } from "./types";

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

type BindingFlowRow = {
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

type BindingRequirementRow = {
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

function readTrialDetail(requestId: number): TrialDetail | null {
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
            CASE WHEN ${TRIAL_RELEASE_OVERDUE_SQL} THEN 1 ELSE 0 END AS isOverdue,
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

// Keep detail and its access scope local to the page render that creates this reader.
export function createTrialDetailReader(user: SessionUser) {
  const viewer = { ...user };
  const details = new Map<number, TrialDetail | null>();
  let readableProjectIds: number[] | null | undefined;
  function getReadableProjectIds() {
    if (readableProjectIds === undefined) readableProjectIds = getProjectWorkflowProjectIds(viewer, true);
    return readableProjectIds;
  }

  function canReadProject(projectId: number) {
    const ids = getReadableProjectIds();
    return ids === null || ids.includes(projectId);
  }

  function getTrialDetail(requestId: number) {
    const cached = details.get(requestId);
    if (cached !== undefined) return cached;
    const detail = readTrialDetail(requestId);
    details.set(requestId, detail);
    return detail;
  }

  function getReadableTrialDetail(requestId: number): TrialDetail | null {
    const detail = getTrialDetail(requestId);
    if (!detail) return null;
    if (canReadEntireTrialRequest(viewer.id, detail.request, getReadableProjectIds())) return detail;
    const requirements = detail.requirements.flatMap((requirement) => {
      if (isPushedBindingOwner(viewer.id, requirement)) return [requirement];
      const flows = requirement.flows.filter((flow) => isBindingFlowParticipant(viewer.id, flow));
      return flows.length ? [{ ...requirement, ...bindingFlowCounts(flows), barcodeEvidenceKey: "", flows, approverOptions: [] }] : [];
    });
    return requirements.length ? { ...detail, requirements } : null;
  }

  return { user: viewer, canReadProject, getTrialDetail, getReadableTrialDetail };
}

export type TrialDetailReader = ReturnType<typeof createTrialDetailReader>;

export type TrialQueueBindingCounts = {
  requirementTotal: number;
  requirementPassed: number;
  requirementWaived: number;
  pendingFlowCount: number;
};
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
