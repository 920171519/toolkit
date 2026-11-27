import { all, db, one } from "./db";
import { canReadBatchEvidence, getBatchEvidenceReadScope, getIntegrationManagedProjectIds, getManagedProjectScope, getNarrowVersionRequestIds, getReadableLinkedBatchEvidence, getReadableVersionIds, type LinkedBatchEvidence } from "./access";
import { getWorkbenchBatches } from "./batch-queries";
import { OPEN_BINDING_RELEASE_STATUSES_SQL, OPEN_BINDING_REQUIREMENT_STATUSES_SQL } from "./binding-availability";
import type { TrialDetail, TrialDetailReader } from "./binding-queries";
import {
  ACTIVE_BINDING_FLOW_STATUSES_SQL,
  bindingBarcodeProgress,
  summarizeBindingBarcodes,
  type BindingBarcodeFact,
} from "./binding-barcode-results";
import { getPageWindow } from "./list-pagination";
import { getReadNotificationKeys } from "./notification-reads";
import { packageCodeSql, packageIdentity } from "./package-identity";
import { getPendingTransferPreviews } from "./pending-transfer-queries";
import { getPendingFormalVersions } from "./release-queue-queries";
import type { SessionUser } from "./types";
import { STANDALONE_VERSION_HISTORY_IN_PROJECT_SQL } from "./version-scope";
import type { TraceListState } from "./version-trace-list";
import { workflowHref } from "./workflow-links";
import { getWorkbenchTrialReadyRows } from "./trial-eligibility";
import { getPendingBindingFlowCounts } from "./trial-readiness";
import { LATEST_TRANSFER_REQUEST_BATCH_ID_SQL } from "./transfer-requests";

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
  const integrationScope = user.role === "ADMIN" ? null : getIntegrationManagedProjectIds(user.id);

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
    for (const { projectId, projectName, total, versions } of getPendingTransferPreviews(managerScope)) {
      tasks.push({
        key: `transfer-${projectId}`,
        title: `${projectName} · ${total} 项待安排转测`,
        description: versions.map(workbenchVersionLabel).join("、") + (total > versions.length ? " 等" : ""),
        href: workflowHref("/submissions", projectId),
        category: "test",
      });
    }
    for (const batch of getWorkbenchBatches(managerScope, "DRAFT")) {
      tasks.push({
        key: `batch-draft-${batch.id}`,
        title: `核对待发起批次：${batch.code} · ${batch.projectName}`,
        description: `${batch.packageCount} 个配套软件包`,
        href: workflowHref(`/integration/${batch.id}`, batch.projectId),
        category: "test",
      });
    }
    const integrationProjects = new Set(integrationScope);
    const trackingScope = managerScope?.filter((projectId) => !integrationProjects.has(projectId)) ?? [];
    for (const batch of getWorkbenchBatches(trackingScope, "IN_TEST")) {
      tasks.push({
        key: `batch-manager-${batch.id}`,
        title: `跟踪测试进度：${batch.code} · ${batch.projectName}`,
        description: `${batch.packageCount} 个变更包 · 待集成测试负责人出结论`,
        href: workflowHref(`/integration/${batch.id}`, batch.projectId),
        category: "test",
      });
    }
    // A shared version stays in its first queue position and displays its last matching project.
    const ready = Array.from(new Map(getWorkbenchTrialReadyRows(managerScope).map((item) => [item.versionId, item])).values());
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

  for (const batch of getWorkbenchBatches(integrationScope, "IN_TEST")) {
    tasks.push({
      key: `integration-test-${batch.id}`,
      title: `提交测试结论：${batch.code} · ${batch.projectName}`,
      description: `${batch.packageCount} 个变更包`,
      href: workflowHref(`/integration/${batch.id}`, batch.projectId),
      category: "test",
    });
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

  const readKeys = getReadNotificationKeys(user.id, [...alerts, ...notifications].map(({ key }) => key));
  const unreadAlerts = alerts.filter((alert) => !readKeys.has(alert.key));
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

export function getVersionTrace(reader: TrialDetailReader, versionId: number, projectId?: number, readableIds = getReadableVersionIds(reader.user)): VersionTrace | null {
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
