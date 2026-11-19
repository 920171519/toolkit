import "server-only";

import { all, one } from "./db";
import { getTransferAreaIds } from "./access";
import { STANDALONE_VERSION_IN_PROJECT_SQL } from "./version-scope";
import type { PackageStatus, Role } from "./constants";
import type {
  BatchItemSummary,
  BatchSummary,
  BindingTaskSummary,
  PackageSummary,
  PackageVersionSummary,
  PendingReleaseVersion,
  ReviewSummary,
  SessionUser,
  TrialVersionSummary,
} from "./types";

type CountRow = { count: number };

export type ProjectContact = {
  id: number;
  name: string;
  employeeId: string;
  title: string;
};

export type PublicProject = {
  id: number;
  name: string;
  code: string;
  status: "ACTIVE" | "PAUSED" | "ARCHIVED";
  pms: ProjectContact[];
  softwareManagers: ProjectContact[];
  pmName: string | null;
  pmEmployeeId: string | null;
  pmTitle: string | null;
  softwareManagerName: string | null;
  softwareManagerEmployeeId: string | null;
  softwareManagerTitle: string | null;
};

export function getPublicProjects(): PublicProject[] {
  const projects = all<{
    id: number;
    name: string;
    code: string;
    status: "ACTIVE" | "PAUSED" | "ARCHIVED";
  }>(
    `SELECT id, name, code, status FROM projects
     WHERE status != 'ARCHIVED' ORDER BY sort_order, id`,
  );
  return projects.map((project) => {
    const pms = all<ProjectContact>(
      `SELECT u.id, u.name, u.employee_id AS employeeId, u.title
       FROM project_pms pp JOIN users u ON u.id = pp.user_id
       WHERE pp.project_id = ? ORDER BY pp.created_at, u.id`,
      project.id,
    );
    const softwareManagers = all<ProjectContact>(
      `SELECT u.id, u.name, u.employee_id AS employeeId, u.title
       FROM project_software_managers psm JOIN users u ON u.id = psm.user_id
       WHERE psm.project_id = ? ORDER BY psm.created_at, u.id`,
      project.id,
    );
    return {
      ...project,
      pms,
      softwareManagers,
      pmName: pms.map((person) => person.name).join(" / ") || null,
      pmEmployeeId: pms[0]?.employeeId ?? null,
      pmTitle: pms[0]?.title ?? null,
      softwareManagerName: softwareManagers.map((person) => person.name).join(" / ") || null,
      softwareManagerEmployeeId: softwareManagers[0]?.employeeId ?? null,
      softwareManagerTitle: softwareManagers[0]?.title ?? null,
    };
  });
}

const PACKAGE_SUMMARY_SQL = `
  SELECT p.id, p.name, p.code, p.description, p.is_active AS isActive,
         p.area_id AS areaId, a.name AS areaName, a.color AS areaColor,
         p.owner_id AS ownerId, o.name AS ownerName, o.employee_id AS ownerEmployeeId, o.title AS ownerTitle,
         p.trial_overdue_days AS trialOverdueDays,
         (SELECT v.version FROM package_versions v
          WHERE v.package_id = p.id AND v.status = 'FORMAL'
          ORDER BY COALESCE(v.formal_released_at, v.updated_at) DESC, v.id DESC LIMIT 1) AS formalVersion,
         (SELECT v.version FROM package_versions v
          WHERE v.package_id = p.id AND v.trial_released_at IS NOT NULL
            AND v.status IN ('TRIAL','PENDING_FORMAL')
          ORDER BY v.trial_released_at DESC, v.id DESC LIMIT 1) AS trialVersion,
         (SELECT v.version FROM package_versions v
          WHERE v.package_id = p.id AND v.status NOT IN ('FORMAL','VOID')
          ORDER BY v.updated_at DESC, v.id DESC LIMIT 1) AS currentVersion,
         (SELECT v.status FROM package_versions v
          WHERE v.package_id = p.id AND v.status NOT IN ('FORMAL','VOID')
          ORDER BY v.updated_at DESC, v.id DESC LIMIT 1) AS currentStatus,
         (SELECT v.id FROM package_versions v
          WHERE v.package_id = p.id AND v.status NOT IN ('FORMAL','VOID')
          ORDER BY v.updated_at DESC, v.id DESC LIMIT 1) AS currentVersionId,
         (SELECT v.version FROM package_versions v
          WHERE v.package_id = p.id AND v.status = 'IN_TEST'
          ORDER BY v.updated_at DESC, v.id DESC LIMIT 1) AS inTestVersion,
         (SELECT v.version FROM package_versions v
          WHERE v.package_id = p.id AND v.status = 'PENDING_TRANSFER'
          ORDER BY v.updated_at DESC, v.id DESC LIMIT 1) AS pendingTransferVersion
  FROM packages p
  LEFT JOIN areas a ON a.id = p.area_id
  LEFT JOIN users o ON o.id = p.owner_id
`;

export function getPackagesOverview(includeInactive = false): PackageSummary[] {
  const packages = all<Omit<PackageSummary, "isActive" | "trialVersions"> & { isActive: number }>(
    `${PACKAGE_SUMMARY_SQL} ${includeInactive ? "" : "WHERE p.is_active = 1"} ORDER BY p.name`,
  ).map((row) => ({
    ...row,
    isActive: Boolean(row.isActive),
  }));
  const trials = all<{ packageId: number; version: string }>(
    `SELECT package_id AS packageId, version FROM package_versions
     WHERE status IN ('TRIAL','PENDING_FORMAL')
     ORDER BY package_id, trial_released_at DESC, id DESC`,
  );
  const trialMap = new Map<number, string[]>();
  for (const trial of trials) {
    const list = trialMap.get(trial.packageId) ?? [];
    list.push(trial.version);
    trialMap.set(trial.packageId, list);
  }
  return packages.map((pkg) => ({
    ...pkg,
    trialVersions: trialMap.get(pkg.id) ?? [],
  }));
}

export function getTransferPackageOptions(user: SessionUser, projectId?: number) {
  const areaIds = getTransferAreaIds(user);
  if (areaIds?.length === 0) return [];
  return all<{ id: number; name: string; code: string; ownerName: string | null }>(
    `SELECT p.id, p.name, p.code, owner.name AS ownerName
     FROM packages p LEFT JOIN users owner ON owner.id = p.owner_id
     WHERE p.is_active = 1
     ${areaIds ? `AND p.area_id IN (${areaIds.map(() => "?").join(",")})` : ""}
     AND EXISTS (
       SELECT 1 FROM package_usages usage JOIN projects pr ON pr.id = usage.project_id
       WHERE usage.package_id = p.id AND pr.status != 'ARCHIVED' ${projectId ? "AND pr.id = ?" : ""}
     )
     ORDER BY p.name`,
    ...(areaIds ?? []),
    ...(projectId ? [projectId] : []),
  );
}


export type PackageUsageScope = {
  projectId: number;
  projectName: string;
  projectCode: string;
  projectStatus: "ACTIVE" | "PAUSED" | "ARCHIVED";
  nodeNames: string[];
};

export type PackageOverviewRow = PackageSummary & {
  usages: PackageUsageScope[];
};

export function getPackageOverviewRows(projectId?: number, includeArchivedUsage = false): PackageOverviewRow[] {
  let packages = getPackagesOverview(true);
  const usageRows = all<{
    packageId: number;
    projectId: number;
    projectName: string;
    projectCode: string;
    projectStatus: "ACTIVE" | "PAUSED" | "ARCHIVED";
    nodeName: string;
  }>(
    `SELECT u.package_id AS packageId, pr.id AS projectId, pr.name AS projectName,
            pr.code AS projectCode, pr.status AS projectStatus, n.name AS nodeName
     FROM package_usages u
     JOIN projects pr ON pr.id = u.project_id
     JOIN project_nodes n ON n.id = u.node_id
     WHERE ${includeArchivedUsage ? "1 = 1" : "(pr.status != 'ARCHIVED' OR pr.id = ?)"}
     ORDER BY pr.sort_order, n.sort_order`,
    ...(includeArchivedUsage ? [] : [projectId ?? null]),
  );
  if (projectId) {
    const allowed = new Set(
      usageRows.filter((row) => row.projectId === projectId).map((row) => row.packageId),
    );
    packages = packages.filter((pkg) => allowed.has(pkg.id));
  }
  const usageMap = new Map<number, PackageUsageScope[]>();
  for (const row of usageRows) {
    if (!includeArchivedUsage && row.projectStatus === "ARCHIVED") continue;
    const scopes = usageMap.get(row.packageId) ?? [];
    let scope = scopes.find((item) => item.projectId === row.projectId);
    if (!scope) {
      scope = {
        projectId: row.projectId,
        projectName: row.projectName,
        projectCode: row.projectCode,
        projectStatus: row.projectStatus,
        nodeNames: [],
      };
      scopes.push(scope);
      usageMap.set(row.packageId, scopes);
    }
    scope.nodeNames.push(row.nodeName);
  }
  const requestRows = all<{
    packageId: number;
    versionId: number;
    version: string;
    status: string;
    formalReleasedAt: string | null;
    trialReleasedAt: string | null;
    updatedAt: string;
    standalone: number;
  }>(
    `SELECT pv.package_id AS packageId, pv.id AS versionId, pv.version, r.status,
            r.formal_released_at AS formalReleasedAt, r.trial_released_at AS trialReleasedAt,
            r.updated_at AS updatedAt, 0 AS standalone
     FROM version_transfer_requests r
     JOIN package_versions pv ON pv.id = r.package_version_id
     JOIN projects pr ON pr.id = r.project_id
     WHERE ${projectId ? "r.project_id = ?" : "pr.status != 'ARCHIVED'"}
     ${projectId ? `UNION ALL
       SELECT pv.package_id, pv.id, pv.version, pv.status, pv.formal_released_at,
              pv.trial_released_at, COALESCE(pv.formal_released_at, pv.trial_released_at, pv.updated_at), 1
       FROM package_versions pv WHERE ${STANDALONE_VERSION_IN_PROJECT_SQL}` : ""}
     ORDER BY updatedAt DESC, versionId DESC`,
    ...(projectId ? [projectId, projectId] : []),
  );
  const byPackage = new Map<number, typeof requestRows>();
  for (const row of requestRows) {
    const list = byPackage.get(row.packageId) ?? [];
    list.push(row);
    byPackage.set(row.packageId, list);
  }
  const projectStatusMap: Record<string, PackageStatus> = {
    PENDING: "PENDING_TRANSFER",
    IN_TEST: "IN_TEST",
    PASSED: "PENDING_TRIAL",
    FAILED: "PENDING_TRIAL",
    BLOCKED: "PENDING_TRIAL",
    TRIAL: "TRIAL",
    PENDING_FORMAL: "PENDING_FORMAL",
    FORMAL: "FORMAL",
    VOID: "VOID",
  };
  return packages.map((pkg) => {
    const requests = byPackage.get(pkg.id) ?? [];
    const formalRequests = requests.filter((request) => request.status === "FORMAL");
    const trialRequests = requests.filter((request) => request.status === "TRIAL" || request.status === "PENDING_FORMAL");
    const current = requests.find((request) => !request.standalone && !["FORMAL", "VOID"].includes(request.status));
    const inTest = requests.find((request) => request.status === "IN_TEST");
    const pendingTransfer = requests.find((request) => request.status === "PENDING");
    const trialVersions = [...new Set(trialRequests.map((request) => request.version))];
    const useAggregate = projectId === undefined && requests.length === 0;
    if (projectId) {
      formalRequests.sort((first, second) =>
        (second.formalReleasedAt ?? second.updatedAt).localeCompare(first.formalReleasedAt ?? first.updatedAt),
      );
    }
    const formalVersion = formalRequests[0]?.version ?? (projectId === undefined ? pkg.formalVersion : null);
    return {
      ...pkg,
      formalVersion,
      trialVersion: trialVersions[0] ?? (useAggregate ? pkg.trialVersion : null),
      trialVersions: useAggregate ? pkg.trialVersions : trialVersions,
      currentVersion: current?.version ?? (useAggregate ? pkg.currentVersion : null),
      currentStatus: current ? projectStatusMap[current.status] ?? null : useAggregate ? pkg.currentStatus : null,
      currentVersionId: current?.versionId ?? (useAggregate ? pkg.currentVersionId : null),
      inTestVersion: inTest?.version ?? null,
      pendingTransferVersion: pendingTransfer?.version ?? null,
      usages: usageMap.get(pkg.id) ?? [],
    };
  });
}

export type DirectoryStats = {
  counts: {
    pendingSubmissions: number;
    activeBatches: number;
    pendingTrial: number;
    inBinding: number;
    pendingFormal: number;
    pendingReviews: number;
  };
  projects: number;
  areas: number;
  packages: number;
  people: number;
};

export function getDirectoryStats(): DirectoryStats {
  const count = (table: string, where = "1=1") =>
    Number(one<CountRow>(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`)?.count ?? 0);
  return {
    counts: {
      pendingSubmissions: count("package_versions", "status = 'PENDING_TRANSFER'"),
      activeBatches: count("integration_batches", "status = 'IN_TEST'"),
      pendingTrial: count("package_versions", "status = 'PENDING_TRIAL'"),
      inBinding: count("package_versions", "status = 'TRIAL'"),
      pendingFormal: count("package_versions", "status = 'PENDING_FORMAL'"),
      pendingReviews:
        count("risk_reviews", "status = 'PENDING'") + count("formal_reviews", "status = 'PENDING'"),
    },
    projects: count("projects", "status != 'ARCHIVED'"),
    areas: count("areas"),
    packages: count("packages", "is_active = 1"),
    people: count("users", "is_active = 1"),
  };
}

export type PendingSubmission = {
  id: number;
  packageId: number;
  packageName: string;
  packageCode: string;
  version: string;
  changeSummary: string;
  archiveUrl: string;
  submittedAt: string;
  submittedById: number | null;
  submittedByName: string | null;
  ownerId: number | null;
  ownerName: string | null;
  areaName: string | null;
  areaColor: string | null;
  projectCount: number;
  nodeCount: number;
};

export function getPendingSubmissions(): PendingSubmission[] {
  return all<Omit<PendingSubmission, "projectCount" | "nodeCount">>(
    `SELECT v.id, p.id AS packageId, p.name AS packageName, p.code AS packageCode,
            v.version, v.change_summary AS changeSummary, v.archive_url AS archiveUrl,
            v.submitted_at AS submittedAt, v.submitted_by AS submittedById,
            su.name AS submittedByName, p.owner_id AS ownerId, o.name AS ownerName,
            a.name AS areaName, a.color AS areaColor
     FROM package_versions v
     JOIN packages p ON p.id = v.package_id
     LEFT JOIN users su ON su.id = v.submitted_by
     LEFT JOIN users o ON o.id = p.owner_id
     LEFT JOIN areas a ON a.id = p.area_id
     WHERE v.status = 'PENDING_TRANSFER'
     ORDER BY v.submitted_at DESC, v.id DESC`,
  ).map((row) => {
    const coverage = one<{ projects: number; nodes: number }>(
      `SELECT COUNT(DISTINCT project_id) AS projects, COUNT(*) AS nodes
       FROM package_usages WHERE package_id = ?`,
      row.packageId,
    );
    return {
      ...row,
      projectCount: Number(coverage?.projects ?? 0),
      nodeCount: Number(coverage?.nodes ?? 0),
    };
  });
}

export type BatchRow = BatchSummary & {
  riskPendingCount?: number;
};

export function getBatches(limit = 50): BatchSummary[] {
  return all<BatchSummary>(
    `SELECT b.id, b.code, b.title, b.status, b.conclusion, b.issue_attribution AS issueAttribution,
            b.created_at AS createdAt, b.sent_at AS sentAt, b.completed_at AS completedAt,
            b.terminated_at AS terminatedAt, b.terminate_reason AS terminateReason,
            b.test_summary AS testSummary, b.test_report_url AS testReportUrl,
            c.name AS createdByName,
            (SELECT COUNT(*) FROM batch_items bi WHERE bi.batch_id = b.id) AS itemCount,
            (SELECT COUNT(*) FROM batch_items bi WHERE bi.batch_id = b.id AND bi.is_changed = 1) AS changedCount,
            (SELECT COUNT(*) FROM batch_items bi JOIN package_versions pv ON pv.id = bi.package_version_id
              WHERE bi.batch_id = b.id AND bi.is_changed = 1 AND pv.status = 'PENDING_TRIAL') AS pendingTrialCount,
            (SELECT COUNT(*) FROM batch_items bi JOIN package_versions pv ON pv.id = bi.package_version_id
              WHERE bi.batch_id = b.id AND bi.is_changed = 1 AND pv.status IN ('TRIAL','PENDING_FORMAL','FORMAL')) AS trialReleasedCount
     FROM integration_batches b
     LEFT JOIN users c ON c.id = b.created_by
     ORDER BY COALESCE(b.sent_at, b.created_at) DESC, b.id DESC
     LIMIT ?`,
    limit,
  ).map((row) => ({
    ...row,
    itemCount: Number(row.itemCount),
    changedCount: Number(row.changedCount),
    pendingTrialCount: Number(row.pendingTrialCount),
    trialReleasedCount: Number(row.trialReleasedCount),
  }));
}

export type BatchDetail = {
  batch: BatchSummary & {
    createdById: number | null;
    riskPendingCount: number;
  };
  items: BatchItemSummary[];
  riskReviews: Array<{
    id: number;
    packageVersionId: number;
    packageName: string;
    version: string;
    status: "PENDING" | "APPROVED" | "REJECTED";
    reason: string;
    conclusion: string | null;
    requestedByName: string | null;
    reviewedByName: string | null;
    createdAt: string;
    reviewedAt: string | null;
  }>;
};

export function getBatchDetail(id: number): BatchDetail | null {
  const batch = one<BatchSummary & { createdById: number | null; riskPendingCount: number }>(
    `SELECT b.id, b.code, b.title, b.status, b.conclusion, b.issue_attribution AS issueAttribution,
            b.created_at AS createdAt, b.sent_at AS sentAt, b.completed_at AS completedAt,
            b.terminated_at AS terminatedAt, b.terminate_reason AS terminateReason,
            b.test_summary AS testSummary, b.test_report_url AS testReportUrl,
            c.name AS createdByName, b.created_by AS createdById,
            (SELECT COUNT(*) FROM batch_items bi WHERE bi.batch_id = b.id) AS itemCount,
            (SELECT COUNT(*) FROM batch_items bi WHERE bi.batch_id = b.id AND bi.is_changed = 1) AS changedCount,
            (SELECT COUNT(*) FROM batch_items bi JOIN package_versions pv ON pv.id = bi.package_version_id
              WHERE bi.batch_id = b.id AND bi.is_changed = 1 AND pv.status = 'PENDING_TRIAL') AS pendingTrialCount,
            (SELECT COUNT(*) FROM batch_items bi JOIN package_versions pv ON pv.id = bi.package_version_id
              WHERE bi.batch_id = b.id AND bi.is_changed = 1 AND pv.status IN ('TRIAL','PENDING_FORMAL','FORMAL')) AS trialReleasedCount,
            (SELECT COUNT(*) FROM risk_reviews rr WHERE rr.batch_id = b.id AND rr.status = 'PENDING') AS riskPendingCount
     FROM integration_batches b
     LEFT JOIN users c ON c.id = b.created_by
     WHERE b.id = ?`,
    id,
  );
  if (!batch) return null;

  const items = all<Omit<BatchItemSummary, "isChanged"> & { isChanged: number }>(
    `SELECT bi.id, bi.package_id AS packageId, p.name AS packageName, p.code AS packageCode,
            bi.package_version_id AS packageVersionId, bi.version, bi.archive_url AS archiveUrl,
            bi.change_summary AS changeSummary, bi.is_changed AS isChanged,
            pv.status AS versionStatus, o.name AS ownerName
     FROM batch_items bi
     JOIN packages p ON p.id = bi.package_id
     JOIN package_versions pv ON pv.id = bi.package_version_id
     LEFT JOIN users o ON o.id = p.owner_id
     WHERE bi.batch_id = ?
     ORDER BY bi.is_changed DESC, p.name`,
    id,
  ).map((row) => ({ ...row, isChanged: Boolean(row.isChanged) }));

  const riskReviews = all<{
    id: number;
    packageVersionId: number;
    packageName: string;
    version: string;
    status: "PENDING" | "APPROVED" | "REJECTED";
    reason: string;
    conclusion: string | null;
    requestedByName: string | null;
    reviewedByName: string | null;
    createdAt: string;
    reviewedAt: string | null;
  }>(
    `SELECT rr.id, rr.package_version_id AS packageVersionId, p.name AS packageName,
            pv.version, rr.status, rr.reason, rr.conclusion,
            rq.name AS requestedByName, rd.name AS reviewedByName,
            rr.created_at AS createdAt, rr.reviewed_at AS reviewedAt
     FROM risk_reviews rr
     JOIN package_versions pv ON pv.id = rr.package_version_id
     JOIN packages p ON p.id = pv.package_id
     LEFT JOIN users rq ON rq.id = rr.requested_by
     LEFT JOIN users rd ON rd.id = rr.reviewed_by
     WHERE rr.batch_id = ?
     ORDER BY rr.created_at DESC`,
    id,
  );

  return {
    batch: {
      ...batch,
      riskPendingCount: Number(batch.riskPendingCount),
      itemCount: Number(batch.itemCount),
      changedCount: Number(batch.changedCount),
      pendingTrialCount: Number(batch.pendingTrialCount),
      trialReleasedCount: Number(batch.trialReleasedCount),
    },
    items,
    riskReviews,
  };
}

export function getActiveBatch(): BatchSummary | null {
  return getBatches(10).find((batch) => batch.status === "IN_TEST") ?? null;
}

export function getPendingTrialVersions(): PendingReleaseVersion[] {
  return all<
    Omit<
      PendingReleaseVersion,
      "projectCount" | "nodeCount"
    >
  >(
    `SELECT pv.id, p.id AS packageId, p.name AS packageName, p.code AS packageCode, pv.version,
            pv.change_summary AS changeSummary, pv.archive_url AS archiveUrl,
            su.name AS submittedByName, pv.submitted_at AS submittedAt,
            b.id AS batchId, b.code AS batchCode, b.conclusion AS batchConclusion,
            b.test_summary AS batchSummary, b.test_report_url AS batchReportUrl,
            rr.id AS riskReviewId, rr.status AS riskReviewStatus, rr.reason AS riskReason,
            rr.conclusion AS riskConclusion, o.name AS ownerName
     FROM package_versions pv
     JOIN packages p ON p.id = pv.package_id
     JOIN batch_items bi ON bi.id = (
       SELECT bi2.id FROM batch_items bi2 WHERE bi2.package_version_id = pv.id ORDER BY bi2.id DESC LIMIT 1
     )
     JOIN integration_batches b ON b.id = bi.batch_id
     LEFT JOIN users su ON su.id = pv.submitted_by
     LEFT JOIN users o ON o.id = p.owner_id
     LEFT JOIN risk_reviews rr ON rr.id = (
       SELECT rr2.id FROM risk_reviews rr2
       WHERE rr2.package_version_id = pv.id AND rr2.batch_id = b.id
       ORDER BY rr2.id DESC LIMIT 1
     )
     WHERE pv.status = 'PENDING_TRIAL'
     ORDER BY b.code DESC, p.name`,
  ).map((row) => {
    const coverage = one<{ projects: number; nodes: number }>(
      `SELECT COUNT(DISTINCT u.project_id) AS projects, COUNT(*) AS nodes
       FROM package_usages u
       JOIN projects pr ON pr.id = u.project_id
       WHERE u.package_id = ? AND pr.status != 'ARCHIVED'`,
      row.packageId,
    );
    return {
      ...row,
      projectCount: Number(coverage?.projects ?? 0),
      nodeCount: Number(coverage?.nodes ?? 0),
    };
  });
}

export function getTrialVersions(): TrialVersionSummary[] {
  return all<TrialVersionSummary>(
    `SELECT pv.id, p.id AS packageId, p.name AS packageName, p.code AS packageCode, pv.version,
            pv.trial_released_at AS trialReleasedAt, pv.archive_url AS archiveUrl,
            pv.change_summary AS changeSummary, o.name AS ownerName,
            b.id AS batchId, b.code AS batchCode,
            (SELECT COUNT(*) FROM binding_tasks bt WHERE bt.package_version_id = pv.id) AS totalTasks,
            (SELECT COUNT(*) FROM binding_tasks bt WHERE bt.package_version_id = pv.id AND bt.status = 'PASSED') AS passedTasks,
            (SELECT COUNT(*) FROM binding_tasks bt WHERE bt.package_version_id = pv.id AND bt.status = 'FAILED') AS failedTasks,
            (SELECT COUNT(DISTINCT bt.project_id) FROM binding_tasks bt WHERE bt.package_version_id = pv.id) AS projectCount
     FROM package_versions pv
     JOIN packages p ON p.id = pv.package_id
     LEFT JOIN users o ON o.id = p.owner_id
     LEFT JOIN batch_items bi ON bi.id = (
       SELECT bi2.id FROM batch_items bi2 WHERE bi2.package_version_id = pv.id ORDER BY bi2.id DESC LIMIT 1
     )
     LEFT JOIN integration_batches b ON b.id = bi.batch_id
     WHERE pv.status = 'TRIAL'
     ORDER BY pv.trial_released_at DESC`,
  ).map((row) => ({
    ...row,
    totalTasks: Number(row.totalTasks),
    passedTasks: Number(row.passedTasks),
    failedTasks: Number(row.failedTasks),
    projectCount: Number(row.projectCount),
  }));
}

export type TrialDetail = {
  version: {
    id: number;
    packageId: number;
    packageName: string;
    packageCode: string;
    version: string;
    changeSummary: string;
    archiveUrl: string;
    trialReleasedAt: string;
    submittedAt: string;
    status: PackageStatus;
    ownerName: string | null;
    ownerEmployeeId: string | null;
    batchId: number | null;
    batchCode: string | null;
  } | null;
  tasks: BindingTaskSummary[];
};

export function getTrialDetail(versionId: number): TrialDetail | null {
  const version = one<TrialDetail["version"] & { status: PackageStatus }>(
    `SELECT pv.id, p.id AS packageId, p.name AS packageName, p.code AS packageCode, pv.version,
            pv.change_summary AS changeSummary, pv.archive_url AS archiveUrl,
            pv.trial_released_at AS trialReleasedAt, pv.submitted_at AS submittedAt, pv.status,
            o.name AS ownerName, o.employee_id AS ownerEmployeeId,
            b.id AS batchId, b.code AS batchCode
     FROM package_versions pv
     JOIN packages p ON p.id = pv.package_id
     LEFT JOIN users o ON o.id = p.owner_id
     LEFT JOIN batch_items bi ON bi.id = (
       SELECT bi2.id FROM batch_items bi2 WHERE bi2.package_version_id = pv.id ORDER BY bi2.id DESC LIMIT 1
     )
     LEFT JOIN integration_batches b ON b.id = bi.batch_id
     WHERE pv.id = ?`,
    versionId,
  );
  if (!version) return null;
  const tasks = all<BindingTaskSummary>(
    `SELECT bt.id, bt.project_id AS projectId, pr.name AS projectName, pr.code AS projectCode,
            bt.node_id AS nodeId, n.name AS nodeName, bt.status, bt.note,
            u.name AS validatedByName, bt.validated_at AS validatedAt
     FROM binding_tasks bt
     JOIN projects pr ON pr.id = bt.project_id
     JOIN project_nodes n ON n.id = bt.node_id
     LEFT JOIN users u ON u.id = bt.validated_by
     WHERE bt.package_version_id = ?
     ORDER BY pr.sort_order, n.sort_order`,
    versionId,
  );
  return { version, tasks };
}

export type PendingFormalItem = {
  id: number;
  packageId: number;
  packageName: string;
  packageCode: string;
  version: string;
  changeSummary: string;
  archiveUrl: string;
  trialReleasedAt: string;
  ownerName: string | null;
  batchId: number | null;
  batchCode: string | null;
  totalTasks: number;
  passedTasks: number;
  projectCount: number;
  formalReviewId: number | null;
  formalReviewStatus: "PENDING" | "APPROVED" | "REJECTED" | null;
  formalReviewComment: string | null;
  formalReviewConclusion: string | null;
  requestedByName: string | null;
  reviewedByName: string | null;
  formalReviewAt: string | null;
};

export function getPendingFormalVersions(): PendingFormalItem[] {
  return all<PendingFormalItem>(
    `SELECT pv.id, p.id AS packageId, p.name AS packageName, p.code AS packageCode, pv.version,
            pv.change_summary AS changeSummary, pv.archive_url AS archiveUrl,
            pv.trial_released_at AS trialReleasedAt, o.name AS ownerName,
            b.id AS batchId, b.code AS batchCode,
            (SELECT COUNT(*) FROM binding_tasks bt WHERE bt.package_version_id = pv.id) AS totalTasks,
            (SELECT COUNT(*) FROM binding_tasks bt WHERE bt.package_version_id = pv.id AND bt.status = 'PASSED') AS passedTasks,
            (SELECT COUNT(DISTINCT bt.project_id) FROM binding_tasks bt WHERE bt.package_version_id = pv.id) AS projectCount,
            fr.id AS formalReviewId, fr.status AS formalReviewStatus, fr.comment AS formalReviewComment,
            fr.conclusion AS formalReviewConclusion, rq.name AS requestedByName, rd.name AS reviewedByName,
            COALESCE(fr.reviewed_at, fr.created_at) AS formalReviewAt
     FROM package_versions pv
     JOIN packages p ON p.id = pv.package_id
     LEFT JOIN users o ON o.id = p.owner_id
     LEFT JOIN batch_items bi ON bi.id = (
       SELECT bi2.id FROM batch_items bi2 WHERE bi2.package_version_id = pv.id ORDER BY bi2.id DESC LIMIT 1
     )
     LEFT JOIN integration_batches b ON b.id = bi.batch_id
     LEFT JOIN formal_reviews fr ON fr.id = (
       SELECT fr2.id FROM formal_reviews fr2 WHERE fr2.package_version_id = pv.id ORDER BY fr2.id DESC LIMIT 1
     )
     LEFT JOIN users rq ON rq.id = fr.requested_by
     LEFT JOIN users rd ON rd.id = fr.reviewed_by
     WHERE pv.status = 'PENDING_FORMAL'
     ORDER BY pv.trial_released_at DESC`,
  ).map((row) => ({
    ...row,
    totalTasks: Number(row.totalTasks),
    passedTasks: Number(row.passedTasks),
    projectCount: Number(row.projectCount),
  }));
}

export function getReviewCenter(): ReviewSummary[] {
  const risk = all<ReviewSummary>(
    `SELECT rr.id, 'RISK' AS type, rr.status, rr.reason, rr.conclusion,
            rr.created_at AS createdAt, rr.reviewed_at AS reviewedAt,
            rq.name AS requestedByName, rd.name AS reviewedByName,
            rr.requested_by AS requestedById, rr.reviewed_by AS reviewedById,
            pv.id AS packageVersionId, p.name AS packageName, pv.version,
            b.id AS batchId, b.code AS batchCode
     FROM risk_reviews rr
     JOIN package_versions pv ON pv.id = rr.package_version_id
     JOIN packages p ON p.id = pv.package_id
     JOIN integration_batches b ON b.id = rr.batch_id
     LEFT JOIN users rq ON rq.id = rr.requested_by
     LEFT JOIN users rd ON rd.id = rr.reviewed_by`,
  );
  const formal = all<ReviewSummary>(
    `SELECT fr.id, 'FORMAL' AS type, fr.status, fr.comment AS reason, fr.conclusion,
            fr.created_at AS createdAt, fr.reviewed_at AS reviewedAt,
            rq.name AS requestedByName, rd.name AS reviewedByName,
            fr.requested_by AS requestedById, fr.reviewed_by AS reviewedById,
            pv.id AS packageVersionId, p.name AS packageName, pv.version,
            NULL AS batchId, NULL AS batchCode
     FROM formal_reviews fr
     JOIN package_versions pv ON pv.id = fr.package_version_id
     JOIN packages p ON p.id = pv.package_id
     LEFT JOIN users rq ON rq.id = fr.requested_by
     LEFT JOIN users rd ON rd.id = fr.reviewed_by`,
  );
  const order = { PENDING: 0, APPROVED: 1, REJECTED: 2 } as const;
  return [...risk, ...formal].sort((a, b) => {
    const statusOrder = order[a.status] - order[b.status];
    if (statusOrder !== 0) return statusOrder;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

export function getAuditLogs(limit = 12): Array<{
  id: number;
  action: string;
  detail: string;
  createdAt: string;
  actorName: string | null;
  entityType: string;
}> {
  return all(
    `SELECT l.id, l.action, l.detail, l.created_at AS createdAt, u.name AS actorName, l.entity_type AS entityType
     FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_id
     ORDER BY l.created_at DESC, l.id DESC LIMIT ?`,
    limit,
  );
}

export type AdminUser = {
  id: number;
  name: string;
  employeeId: string;
  role: Role;
  title: string;
  department: string;
  isActive: boolean;
  createdAt: string;
  ownedPackages: number;
};

export function getAdminUsers(): AdminUser[] {
  return all<Omit<AdminUser, "isActive"> & { isActive: number }>(
    `SELECT u.id, u.name, u.employee_id AS employeeId, u.role, u.title, u.department,
            u.is_active AS isActive, u.created_at AS createdAt,
            (SELECT COUNT(*) FROM packages p WHERE p.owner_id = u.id) AS ownedPackages
     FROM users u ORDER BY u.is_active DESC, u.created_at, u.id`,
  ).map((row) => ({
    ...row,
    isActive: Boolean(row.isActive),
    ownedPackages: Number(row.ownedPackages),
  }));
}

export type PersonOption = {
  id: number;
  name: string;
  employeeId: string;
  title: string;
  role: Role;
};

export function getPeople(includeInactive = false): PersonOption[] {
  return all<PersonOption>(
    `SELECT id, name, employee_id AS employeeId, title, role FROM users
     ${includeInactive ? "" : "WHERE is_active = 1"} ORDER BY name`,
  );
}

export type AreaProjectLead = {
  id: number;
  projectId: number;
  projectName: string;
  projectCode: string;
  projectStatus: "ACTIVE" | "PAUSED" | "ARCHIVED";
  userId: number;
  userName: string;
  userEmployeeId: string;
  userTitle: string;
};

export type AreaLeader = {
  id: number;
  userId: number;
  userName: string;
  userEmployeeId: string;
  userTitle: string;
};

export type AreaProjectMember = {
  id: number;
  areaId: number;
  projectId: number;
  projectName: string;
  projectCode: string;
  userId: number;
  userName: string;
  userEmployeeId: string;
  userTitle: string;
};

export type AreaConfig = {
  id: number;
  name: string;
  description: string;
  isIntegration: boolean;
  packageCount: number;
  leaders: AreaLeader[];
  projectLeads: AreaProjectLead[];
  projectMembers: AreaProjectMember[];
};

export function getAreaConfigs(): AreaConfig[] {
  return all<{
    id: number;
    name: string;
    description: string;
    isIntegration: number;
    packageCount: number;
  }>(
    `SELECT a.id, a.name, a.description, a.is_integration AS isIntegration,
            (SELECT COUNT(*) FROM packages p WHERE p.area_id = a.id) AS packageCount
     FROM areas a ORDER BY a.id`,
  ).map((area) => {
    const leaders = all<AreaLeader>(
      `SELECT al.id, u.id AS userId, u.name AS userName, u.employee_id AS userEmployeeId, u.title AS userTitle
       FROM area_leaders al JOIN users u ON u.id = al.user_id
       WHERE al.area_id = ? ORDER BY al.id`,
      area.id,
    );
    const projectMembers = all<AreaProjectMember>(
      `SELECT apm.id, apm.area_id AS areaId, apm.project_id AS projectId, pr.name AS projectName,
              pr.code AS projectCode, u.id AS userId, u.name AS userName,
              u.employee_id AS userEmployeeId, u.title AS userTitle
       FROM area_project_members apm
       JOIN projects pr ON pr.id = apm.project_id
       JOIN users u ON u.id = apm.user_id
       WHERE apm.area_id = ?
       ORDER BY pr.sort_order, u.name`,
      area.id,
    );
    const projectLeads = all<AreaProjectLead>(
      `SELECT apl.id, apl.project_id AS projectId, pr.name AS projectName,
              pr.code AS projectCode, pr.status AS projectStatus,
              u.id AS userId, u.name AS userName, u.employee_id AS userEmployeeId, u.title AS userTitle
       FROM area_project_leads apl
       JOIN projects pr ON pr.id = apl.project_id
       JOIN users u ON u.id = apl.user_id
       WHERE apl.area_id = ?
       ORDER BY pr.sort_order, pr.id`,
      area.id,
    );
    return {
      ...area,
      isIntegration: Boolean(area.isIntegration),
      packageCount: Number(area.packageCount),
      leaders,
      projectLeads,
      projectMembers,
    };
  });
}

export type ProjectConfig = {
  id: number;
  name: string;
  code: string;
  description: string;
  status: "ACTIVE" | "PAUSED" | "ARCHIVED";
  pms: ProjectContact[];
  softwareManagers: ProjectContact[];
  pmUserId: number | null;
  pmName: string | null;
  softwareManagerUserId: number | null;
  softwareManagerName: string | null;
  sortOrder: number;
  nodes: Array<{
    id: number;
    name: string;
    description: string;
    bindingOwnerId: number | null;
    bindingOwnerName: string | null;
    bindingApproverId: number | null;
    bindingApproverName: string | null;
    requiredBindingCount: number;
    approvers: Array<{
      id: number;
      userId: number;
      userName: string;
      userEmployeeId: string;
    }>;
  }>;
  packageCount: number;
};

export function getProjectConfigs(): ProjectConfig[] {
  return all<Omit<ProjectConfig, "nodes" | "packageCount" | "pms" | "softwareManagers"> & { packageCount: number }>(
    `SELECT p.id, p.name, p.code, p.description, p.status,
            p.sort_order AS sortOrder,
            (SELECT COUNT(DISTINCT pu.package_id) FROM package_usages pu WHERE pu.project_id = p.id) AS packageCount
     FROM projects p
     ORDER BY p.sort_order, p.id`,
  ).map((project) => {
    const pms = all<ProjectContact>(
      `SELECT u.id, u.name, u.employee_id AS employeeId, u.title
       FROM project_pms pp JOIN users u ON u.id = pp.user_id
       WHERE pp.project_id = ? ORDER BY pp.created_at, u.id`,
      project.id,
    );
    const softwareManagers = all<ProjectContact>(
      `SELECT u.id, u.name, u.employee_id AS employeeId, u.title
       FROM project_software_managers psm JOIN users u ON u.id = psm.user_id
       WHERE psm.project_id = ? ORDER BY psm.created_at, u.id`,
      project.id,
    );
    return {
      ...project,
      pms,
      softwareManagers,
      pmUserId: pms[0]?.id ?? null,
      pmName: pms.map((person) => person.name).join(" / ") || null,
      softwareManagerUserId: softwareManagers[0]?.id ?? null,
      softwareManagerName: softwareManagers.map((person) => person.name).join(" / ") || null,
      packageCount: Number(project.packageCount),
      nodes: all<{
        id: number;
        name: string;
        description: string;
        bindingOwnerId: number | null;
        bindingOwnerName: string | null;
        bindingApproverId: number | null;
        bindingApproverName: string | null;
        requiredBindingCount: number;
      }>(
        `SELECT n.id, n.name, n.description, n.binding_owner_id AS bindingOwnerId,
                bo.name AS bindingOwnerName, n.binding_approver_id AS bindingApproverId,
                ba.name AS bindingApproverName, n.required_binding_count AS requiredBindingCount
         FROM project_nodes n
         LEFT JOIN users bo ON bo.id = n.binding_owner_id
         LEFT JOIN users ba ON ba.id = n.binding_approver_id
         WHERE n.project_id = ? ORDER BY n.sort_order, n.id`,
        project.id,
      ).map((node) => ({
        ...node,
        approvers: all<{ id: number; userId: number; userName: string; userEmployeeId: string }>(
          `SELECT pna.id, pna.user_id AS userId, u.name AS userName, u.employee_id AS userEmployeeId
           FROM project_node_approvers pna JOIN users u ON u.id = pna.user_id
           WHERE pna.node_id = ? ORDER BY pna.id`,
          node.id,
        ),
      })),
    };
  });
}

export type AdminPackage = PackageSummary & {
  versionCount: number;
  usageCount: number;
  usageLabel: string | null;
};

export function getAdminPackages(): AdminPackage[] {
  return getPackagesOverview(true).map((pkg) => {
    const counts = one<{ versionCount: number; usageCount: number }>(
      `SELECT (SELECT COUNT(*) FROM package_versions WHERE package_id = ?) AS versionCount,
              (SELECT COUNT(*) FROM package_usages WHERE package_id = ?) AS usageCount`,
      pkg.id,
      pkg.id,
    );
    return {
      ...pkg,
      versionCount: Number(counts?.versionCount ?? 0),
      usageCount: Number(counts?.usageCount ?? 0),
      usageLabel: null,
    };
  });
}

export type PackageVersionOption = {
  id: number;
  version: string;
  status: PackageStatus;
  changeSummary: string;
  archiveUrl: string;
  buildUrl: string | null;
  submittedAt: string;
};

export type BatchCandidatePackage = {
  packageId: number;
  packageName: string;
  packageCode: string;
  ownerName: string | null;
  areaName: string | null;
  areaColor: string | null;
  versions: PackageVersionOption[];
  pendingVersionId: number | null;
};

export function getBatchCandidates(): BatchCandidatePackage[] {
  const packages = all<{
    packageId: number;
    packageName: string;
    packageCode: string;
    ownerName: string | null;
    areaName: string | null;
    areaColor: string | null;
  }>(
    `SELECT p.id AS packageId, p.name AS packageName, p.code AS packageCode,
            u.name AS ownerName, a.name AS areaName, a.color AS areaColor
     FROM packages p
     LEFT JOIN users u ON u.id = p.owner_id
     LEFT JOIN areas a ON a.id = p.area_id
     WHERE p.is_active = 1 ORDER BY p.name`,
  );
  return packages.map((pkg) => {
    const versions = all<PackageVersionOption>(
      `SELECT id, version, status, change_summary AS changeSummary, archive_url AS archiveUrl,
              build_url AS buildUrl, submitted_at AS submittedAt
       FROM package_versions WHERE package_id = ?
       ORDER BY CASE status
         WHEN 'PENDING_TRANSFER' THEN 0 WHEN 'IN_TEST' THEN 1 WHEN 'PENDING_TRIAL' THEN 2
         WHEN 'TRIAL' THEN 3 WHEN 'PENDING_FORMAL' THEN 4 ELSE 5 END,
         submitted_at DESC, id DESC`,
      pkg.packageId,
    );
    return {
      ...pkg,
      versions,
      pendingVersionId: versions.find((version) => version.status === "PENDING_TRANSFER")?.id ?? null,
    };
  });
}

export type PackageDetailData = {
  package: PackageSummary;
  usages: Array<{
    projectId: number;
    projectName: string;
    projectCode: string;
    projectStatus: "ACTIVE" | "PAUSED" | "ARCHIVED";
    nodes: Array<{ nodeId: number; nodeName: string }>;
  }>;
  versions: Array<
    PackageVersionSummary & {
      batchCode: string | null;
      gateLabel: string | null;
      gateStatus: string | null;
    }
  >;
  audits: Array<{ id: number; action: string; detail: string; createdAt: string; actorName: string | null }>;
};

export function getPackageDetail(packageId: number, includeInactive = false, projectId?: number): PackageDetailData | null {
  const packages = projectId ? getPackageOverviewRows(projectId) : getPackagesOverview(includeInactive);
  const base = packages.find((pkg) => pkg.id === packageId);
  if (!base) return null;
  const usageRows = all<{
    projectId: number;
    projectName: string;
    projectCode: string;
    projectStatus: "ACTIVE" | "PAUSED" | "ARCHIVED";
    nodeId: number;
    nodeName: string;
  }>(
    `SELECT p.id AS projectId, p.name AS projectName, p.code AS projectCode, p.status AS projectStatus,
            n.id AS nodeId, n.name AS nodeName
     FROM package_usages u
     JOIN projects p ON p.id = u.project_id
     JOIN project_nodes n ON n.id = u.node_id
     WHERE u.package_id = ? AND p.status != 'ARCHIVED'
     ORDER BY p.sort_order, n.sort_order`,
    packageId,
  );
  const usageMap = new Map<number, PackageDetailData["usages"][number]>();
  for (const usage of usageRows) {
    const existing = usageMap.get(usage.projectId);
    if (existing) {
      existing.nodes.push({ nodeId: usage.nodeId, nodeName: usage.nodeName });
    } else {
      usageMap.set(usage.projectId, {
        projectId: usage.projectId,
        projectName: usage.projectName,
        projectCode: usage.projectCode,
        projectStatus: usage.projectStatus,
        nodes: [{ nodeId: usage.nodeId, nodeName: usage.nodeName }],
      });
    }
  }
  const versions = all<PackageVersionSummary>(
    `SELECT pv.id, pv.package_id AS packageId, p.name AS packageName, p.code AS packageCode,
            pv.version, pv.change_summary AS changeSummary, pv.archive_url AS archiveUrl, pv.build_url AS buildUrl,
            pv.void_kind AS voidKind, pv.status,
            pv.submitted_at AS submittedAt, pv.submitted_by AS submittedById, su.name AS submittedByName,
            pv.trial_released_at AS trialReleasedAt, pv.formal_released_at AS formalReleasedAt,
            pv.form_flow_no AS formFlowNo,
            b.id AS batchId, b.code AS batchCode, b.status AS batchStatus, b.conclusion AS batchConclusion,
            rr.status AS riskReviewStatus, fr.status AS formalReviewStatus,
             (SELECT COUNT(*) FROM binding_requirements br WHERE br.package_version_id = pv.id
                AND (? IS NULL OR br.project_id = ?)) AS bindingTotal,
             (SELECT COUNT(*) FROM binding_requirements br WHERE br.package_version_id = pv.id AND br.status = 'PASSED'
                AND (? IS NULL OR br.project_id = ?)) AS bindingPassed,
            o.name AS ownerName
     FROM package_versions pv
     JOIN packages p ON p.id = pv.package_id
     LEFT JOIN users su ON su.id = pv.submitted_by
     LEFT JOIN users o ON o.id = p.owner_id
     LEFT JOIN batch_items bi ON bi.id = (
        SELECT bi2.id FROM batch_items bi2 JOIN integration_batches b2 ON b2.id = bi2.batch_id
        WHERE bi2.package_version_id = pv.id AND (? IS NULL OR b2.project_id = ?)
        ORDER BY bi2.id DESC LIMIT 1
     )
     LEFT JOIN integration_batches b ON b.id = bi.batch_id
     LEFT JOIN risk_reviews rr ON rr.id = (
       SELECT rr2.id FROM risk_reviews rr2 WHERE rr2.package_version_id = pv.id ORDER BY rr2.id DESC LIMIT 1
     )
     LEFT JOIN formal_reviews fr ON fr.id = (
       SELECT fr2.id FROM formal_reviews fr2 WHERE fr2.package_version_id = pv.id ORDER BY fr2.id DESC LIMIT 1
     )
      WHERE pv.package_id = ?
        AND (? IS NULL OR bi.id IS NOT NULL OR EXISTS (
          SELECT 1 FROM version_transfer_requests r WHERE r.package_version_id = pv.id AND r.project_id = ?
        ) OR (${STANDALONE_VERSION_IN_PROJECT_SQL}))
     ORDER BY pv.submitted_at DESC, pv.id DESC`,
    projectId ?? null, projectId ?? null,
    projectId ?? null, projectId ?? null,
    projectId ?? null, projectId ?? null,
    packageId,
    projectId ?? null, projectId ?? null, projectId ?? null,
  ).map((version) => ({
    ...version,
    bindingTotal: Number(version.bindingTotal),
    bindingPassed: Number(version.bindingPassed),
    gateLabel: null,
    gateStatus: null,
  }));
  const audits = all<{
    id: number;
    action: string;
    detail: string;
    createdAt: string;
    actorName: string | null;
  }>(
    `SELECT l.id, l.action, l.detail, l.created_at AS createdAt, u.name AS actorName
     FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_id
     WHERE l.entity_type = 'PACKAGE' AND l.entity_id = ?
     ORDER BY l.created_at DESC, l.id DESC LIMIT 20`,
    packageId,
  );
  return {
    package: base,
    usages: [...usageMap.values()],
    versions,
    audits,
  };
}

export type ProjectView = {
  id: number;
  name: string;
  code: string;
  description: string;
  status: "ACTIVE" | "PAUSED" | "ARCHIVED";
  pms: ProjectContact[];
  softwareManagers: ProjectContact[];
  pmName: string | null;
  pmEmployeeId: string | null;
  pmTitle: string | null;
  softwareManagerName: string | null;
  softwareManagerEmployeeId: string | null;
  softwareManagerTitle: string | null;
  nodes: Array<{ id: number; name: string; description: string }>;
  packages: Array<
    PackageSummary & {
      nodeNames: string[];
      activeWork: Array<{ version: string; status: PackageStatus }>;
    }
  >;
};

export function getProjectViews(): ProjectView[] {
  const projects = all<{
    id: number;
    name: string;
    code: string;
    description: string;
    status: "ACTIVE" | "PAUSED" | "ARCHIVED";
  }>(
    `SELECT p.id, p.name, p.code, p.description, p.status
     FROM projects p
     ORDER BY p.sort_order, p.id`,
  ).map((project) => {
    const pms = all<ProjectContact>(
      `SELECT u.id, u.name, u.employee_id AS employeeId, u.title
       FROM project_pms pp JOIN users u ON u.id = pp.user_id
       WHERE pp.project_id = ? ORDER BY pp.created_at, u.id`,
      project.id,
    );
    const softwareManagers = all<ProjectContact>(
      `SELECT u.id, u.name, u.employee_id AS employeeId, u.title
       FROM project_software_managers psm JOIN users u ON u.id = psm.user_id
       WHERE psm.project_id = ? ORDER BY psm.created_at, u.id`,
      project.id,
    );
    return {
      ...project,
      pms,
      softwareManagers,
      pmName: pms.map((person) => person.name).join(" / ") || null,
      pmEmployeeId: pms[0]?.employeeId ?? null,
      pmTitle: pms[0]?.title ?? null,
      softwareManagerName: softwareManagers.map((person) => person.name).join(" / ") || null,
      softwareManagerEmployeeId: softwareManagers[0]?.employeeId ?? null,
      softwareManagerTitle: softwareManagers[0]?.title ?? null,
    };
  });
  const allPackages = getPackagesOverview(true);
  return projects.map((project) => {
    const nodes = all<{ id: number; name: string; description: string }>(
      "SELECT id, name, description FROM project_nodes WHERE project_id = ? ORDER BY sort_order, id",
      project.id,
    );
    const packageRows = all<{ packageId: number; nodeId: number; nodeName: string }>(
      `SELECT u.package_id AS packageId, u.node_id AS nodeId, n.name AS nodeName
       FROM package_usages u JOIN project_nodes n ON n.id = u.node_id
       WHERE u.project_id = ? ORDER BY n.sort_order`,
      project.id,
    );
    const byPackage = new Map<number, string[]>();
    for (const row of packageRows) {
      const nodeNames = byPackage.get(row.packageId) ?? [];
      nodeNames.push(row.nodeName);
      byPackage.set(row.packageId, nodeNames);
    }
    const packages = [...byPackage.entries()]
      .map(([packageId, nodeNames]) => {
        const pkg = allPackages.find((item) => item.id === packageId);
        if (!pkg) return null;
        const activeWork = all<{ version: string; status: PackageStatus }>(
          `SELECT version, status FROM package_versions
           WHERE package_id = ? AND status != 'FORMAL'
           ORDER BY updated_at DESC, id DESC LIMIT 2`,
          packageId,
        );
        return { ...pkg, nodeNames, activeWork };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
    return { ...project, nodes, packages };
  });
}

export function getProjectPackageUsageOptions(): Array<{
  projectId: number;
  packageId: number;
  nodeIds: number[];
}> {
  return all<{ projectId: number; packageId: number; nodeIds: string }>(
    `SELECT project_id AS projectId, package_id AS packageId,
            GROUP_CONCAT(node_id) AS nodeIds
     FROM package_usages GROUP BY project_id, package_id`,
  ).map((row) => ({
    projectId: row.projectId,
    packageId: row.packageId,
    nodeIds: String(row.nodeIds)
      .split(",")
      .map(Number),
  }));
}

export type PackageVersionView = {
  id: number;
  packageName: string;
  version: string;
  status: PackageStatus;
  changeSummary: string;
  archiveUrl: string;
  batchCode: string | null;
};

export function getPackageVersions(packageId: number): PackageVersionView[] {
  return all<PackageVersionView>(
    `SELECT pv.id, p.name AS packageName, pv.version, pv.status, pv.change_summary AS changeSummary,
            pv.archive_url AS archiveUrl,
            (SELECT b.code FROM batch_items bi JOIN integration_batches b ON b.id = bi.batch_id
             WHERE bi.package_version_id = pv.id ORDER BY bi.id DESC LIMIT 1) AS batchCode
     FROM package_versions pv JOIN packages p ON p.id = pv.package_id
     WHERE pv.package_id = ? ORDER BY pv.submitted_at DESC, pv.id DESC`,
    packageId,
  );
}

export type Notice = {
  tone: "success" | "error" | "info";
  message: string;
};

export function parseFlash(
  flash: string | string[] | undefined,
  fallbackTone: "success" | "error" | "info" = "success",
): Notice | null {
  if (!flash) return null;
  return { tone: fallbackTone, message: Array.isArray(flash) ? flash[0] : flash };
}

export function getReviewById(id: number): ReviewSummary | null {
  return getReviewCenter().find((review) => review.id === id) ?? null;
}
