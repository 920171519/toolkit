import "server-only";

import { all, one } from "./db";
import { canEditPackageResponsibility, getReadableBatchEvidenceIds, getReadablePackageIds, getReadableVersionIds, getTransferAreaIds } from "./access";
import { STANDALONE_IMPORTED_VERSION_SQL, STANDALONE_VERSION_HISTORY_IN_PROJECT_SQL, STANDALONE_VERSION_IN_PROJECT_SQL } from "./version-scope";
import type { PackageProgressStatus, Role } from "./constants";
import { getTrialProgress } from "./trial-eligibility";
import { packageCodeSql } from "./package-identity";
import type { PackageSummary, PackageVersionSummary, SessionUser } from "./types";

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
         current_version.version AS currentVersion, current_version.status AS currentStatus,
         current_version.id AS currentVersionId,
         (SELECT v.version FROM package_versions v
          WHERE v.package_id = p.id AND v.status = 'IN_TEST'
          ORDER BY v.updated_at DESC, v.id DESC LIMIT 1) AS inTestVersion,
         (SELECT v.version FROM package_versions v
          WHERE v.package_id = p.id AND v.status = 'PENDING_TRANSFER'
          ORDER BY v.updated_at DESC, v.id DESC LIMIT 1) AS pendingTransferVersion
  FROM packages p
  LEFT JOIN areas a ON a.id = p.area_id
  LEFT JOIN users o ON o.id = p.owner_id
  LEFT JOIN package_versions current_version ON current_version.id = (
    SELECT pv.id FROM package_versions pv
    WHERE pv.package_id = p.id AND pv.status NOT IN ('FORMAL','VOID')
      AND (pv.status != 'TRIAL' OR NOT ${STANDALONE_IMPORTED_VERSION_SQL})
    ORDER BY pv.updated_at DESC, pv.id DESC LIMIT 1
  )
`;

function readPackagesOverview(includeInactive: boolean, packageId?: number): PackageSummary[] {
  const conditions: string[] = [];
  if (!includeInactive) conditions.push("p.is_active = 1");
  if (packageId !== undefined) conditions.push("p.id = ?");
  const values = packageId === undefined ? [] : [packageId];
  const packages = all<Omit<PackageSummary, "isActive" | "trialVersions"> & { isActive: number }>(
    `${PACKAGE_SUMMARY_SQL} ${conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`}
     ORDER BY ${packageCodeSql("p.name", "p.code")} COLLATE NOCASE, p.id`,
    ...values,
  ).map((row) => ({
    ...row,
    isActive: Boolean(row.isActive),
  }));
  if (packages.length === 0) return [];
  const trials = all<{ packageId: number; version: string }>(
    `SELECT package_id AS packageId, version FROM package_versions
     WHERE status IN ('TRIAL','PENDING_FORMAL')
     ${packageId === undefined ? "" : "AND package_id = ?"}
     ORDER BY package_id, trial_released_at DESC, id DESC`,
    ...values,
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

function withTrialProgress<T extends PackageSummary>(packages: T[], projectId?: number): T[] {
  const progress = getTrialProgress(packages.flatMap((pkg) => pkg.currentVersionId === null ? [] : [pkg.currentVersionId]), projectId);
  return packages.map((pkg) => {
    const trial = pkg.currentVersionId === null ? undefined : progress.get(pkg.currentVersionId);
    const status = pkg.currentStatus;
    if (projectId !== undefined && !trial?.inProjectScope) return pkg;
    if (trial?.missingRequestCount) return { ...pkg, currentStatus: "MISSING_TRANSFER_REQUEST" };
    if (trial?.releaseMode === "INTEGRATION") return { ...pkg, currentStatus: "PENDING_TRIAL" };
    if (trial?.releaseMode === "RISK") return { ...pkg, currentStatus: "RISK_TRIAL_READY" };
    if (trial?.passedInProject) return { ...pkg, currentStatus: "WAITING_OTHER_ACCEPTANCE" };
    if (status === "PENDING_TRIAL" || (trial && status === "TEST_PASSED")) {
      return { ...pkg, currentStatus: "WAITING_ACCEPTANCE" };
    }
    return pkg;
  });
}

export function getPackagesOverview(includeInactive = false): PackageSummary[] {
  return withTrialProgress(readPackagesOverview(includeInactive));
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
     ORDER BY ${packageCodeSql("p.name", "p.code")} COLLATE NOCASE, p.id`,
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
  return readPackageOverviewRows({ projectId, includeArchivedUsage });
}

function readPackageOverviewRows({ projectId, includeArchivedUsage, packageId }: {
  projectId?: number;
  includeArchivedUsage: boolean;
  packageId?: number;
}): PackageOverviewRow[] {
  let packages = readPackagesOverview(true, packageId);
  if (packages.length === 0) return [];
  const packageValues = packageId === undefined ? [] : [packageId];
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
       ${packageId === undefined ? "" : "AND u.package_id = ?"}
     ORDER BY pr.sort_order, n.sort_order`,
    ...(includeArchivedUsage ? [] : [projectId ?? null]),
    ...packageValues,
  );
  if (projectId) {
    const allowed = new Set(
      usageRows.filter((row) => row.projectId === projectId).map((row) => row.packageId),
    );
    packages = packages.filter((pkg) => allowed.has(pkg.id));
  }
  if (packages.length === 0) return [];
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
  const requestPackageCondition = packageId === undefined ? "" : "AND pv.package_id = ?";
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
     WHERE ${projectId ? "r.project_id = ?" : "pr.status != 'ARCHIVED'"} ${requestPackageCondition}
     ${projectId ? `UNION ALL
       SELECT pv.package_id, pv.id, pv.version, pv.status, pv.formal_released_at,
              pv.trial_released_at, COALESCE(pv.formal_released_at, pv.trial_released_at, pv.updated_at), 1
       FROM package_versions pv WHERE ${STANDALONE_VERSION_IN_PROJECT_SQL} ${requestPackageCondition}` : ""}
     ORDER BY updatedAt DESC, versionId DESC`,
    ...(projectId ? [projectId] : []),
    ...packageValues,
    ...(projectId ? [projectId, ...packageValues] : []),
  );
  const byPackage = new Map<number, typeof requestRows>();
  for (const row of requestRows) {
    const list = byPackage.get(row.packageId) ?? [];
    list.push(row);
    byPackage.set(row.packageId, list);
  }
  const projectStatusMap: Record<string, PackageProgressStatus> = {
    PENDING: "PENDING_TRANSFER",
    IN_TEST: "IN_TEST",
    PASSED: "TEST_PASSED",
    FAILED: "TEST_FAILED",
    BLOCKED: "TEST_BLOCKED",
    TRIAL: "TRIAL",
    PENDING_FORMAL: "PENDING_FORMAL",
    FORMAL: "FORMAL",
    VOID: "VOID",
  };
  const rows = packages.map((pkg) => {
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
  return withTrialProgress(rows, projectId);
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
  activeOwnedPackages: number;
  areas: Array<{ id: number; name: string }>;
};

export function getAdminUsers(userId?: number): AdminUser[] {
  const memberships = getAreaMemberships(userId);
  const areasByUser = Map.groupBy(memberships, (membership) => membership.userId);
  return all<Omit<AdminUser, "isActive" | "areas"> & { isActive: number }>(
    `SELECT u.id, u.name, u.employee_id AS employeeId, u.role, u.title, u.department,
            u.is_active AS isActive, u.created_at AS createdAt,
            (SELECT COUNT(*) FROM packages p WHERE p.owner_id = u.id) AS ownedPackages,
            (SELECT COUNT(*) FROM packages p WHERE p.owner_id = u.id AND p.is_active = 1) AS activeOwnedPackages
     FROM users u
     ${userId === undefined ? "" : "WHERE u.id = ?"}
     ORDER BY u.is_active DESC, u.created_at, u.id`,
    ...(userId === undefined ? [] : [userId]),
  ).map((row) => ({
    ...row,
    isActive: Boolean(row.isActive),
    ownedPackages: Number(row.ownedPackages),
    activeOwnedPackages: Number(row.activeOwnedPackages),
    areas: (areasByUser.get(row.id) ?? []).map(({ areaId, name }) => ({ id: areaId, name })),
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

type AreaConfig = {
  id: number;
  name: string;
  description: string;
  isIntegration: boolean;
  packageCount: number;
  leaders: AreaLeader[];
  projectLeads: AreaProjectLead[];
  projectMembers: AreaProjectMember[];
};

export function getAreaMemberships(userId?: number) {
  return all<{ userId: number; areaId: number; name: string }>(
    `WITH memberships AS (
      SELECT user_id, area_id FROM area_leaders
      UNION
      SELECT user_id, area_id FROM area_project_leads
      UNION
      SELECT user_id, area_id FROM area_project_members
    )
    SELECT m.user_id AS userId, m.area_id AS areaId, a.name
    FROM memberships m JOIN areas a ON a.id = m.area_id
    ${userId === undefined ? "" : "WHERE m.user_id = ?"}
    ORDER BY a.name, a.id`,
    ...(userId === undefined ? [] : [userId]),
  );
}

export function getAccountAreaLabel(userId: number): string {
  return getAreaMemberships(userId).map(({ name }) => name).join("、") || "未分配责任田";
}

export function getResponsibilityAreaOptions({ orderBy = "name" }: { orderBy?: "name" | "id" } = {}) {
  const order = orderBy === "id" ? "id" : "name, id";
  return all<{ id: number; name: string }>(`SELECT id, name FROM areas ORDER BY ${order}`);
}

export function getAreaDirectory() {
  const supervisors = all<AreaLeader & { areaId: number }>(
    `SELECT al.id, al.area_id AS areaId, u.id AS userId, u.name AS userName,
            u.employee_id AS userEmployeeId, u.title AS userTitle
     FROM area_leaders al JOIN users u ON u.id = al.user_id
     ORDER BY al.id`,
  );
  const supervisorsByArea = Map.groupBy(supervisors, (leader) => leader.areaId);

  return all<{
    id: number;
    name: string;
    description: string;
    isIntegration: number;
    packageCount: number;
    projectCount: number;
  }>(
    `SELECT a.id, a.name, a.description, a.is_integration AS isIntegration,
            (SELECT COUNT(*) FROM packages p WHERE p.area_id = a.id) AS packageCount,
            (SELECT COUNT(*) FROM area_project_leads apl WHERE apl.area_id = a.id) AS projectCount
     FROM areas a ORDER BY a.id`,
  ).map((area) => ({
    ...area,
    isIntegration: Boolean(area.isIntegration),
    leaders: supervisorsByArea.get(area.id) ?? [],
  }));
}

export function getAreaConfig(areaId: number): AreaConfig | null {
  const area = one<{
    id: number;
    name: string;
    description: string;
    isIntegration: number;
    packageCount: number;
  }>(
    `SELECT a.id, a.name, a.description, a.is_integration AS isIntegration,
            (SELECT COUNT(*) FROM packages p WHERE p.area_id = a.id) AS packageCount
     FROM areas a WHERE a.id = ?`,
    areaId,
  );
  if (!area) return null;

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
}

export type AdminPackage = PackageSummary & {
  versionCount: number;
  usageCount: number;
  usageLabel: string | null;
};

export function getAdminPackages(): AdminPackage[] {
  const packages = getPackagesOverview(true);
  if (packages.length === 0) return [];
  const countsByPackage = new Map(all<{
    id: number;
    versionCount: number | null;
    usageCount: number | null;
  }>(
    `SELECT p.id, v.total AS versionCount, u.total AS usageCount
     FROM packages p
     LEFT JOIN (
       SELECT package_id, COUNT(*) AS total FROM package_versions GROUP BY package_id
     ) v ON v.package_id = p.id
     LEFT JOIN (
       SELECT package_id, COUNT(*) AS total FROM package_usages GROUP BY package_id
     ) u ON u.package_id = p.id`,
  ).map((counts) => [counts.id, counts]));
  return packages.map((pkg) => {
    const counts = countsByPackage.get(pkg.id);
    return {
      ...pkg,
      versionCount: Number(counts?.versionCount ?? 0),
      usageCount: Number(counts?.usageCount ?? 0),
      usageLabel: null,
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

function restrictPackageSummary<T extends PackageSummary>(pkg: T, visibleVersions: Set<string>): T {
  const visible = (version: string | null) => version !== null && visibleVersions.has(version) ? version : null;
  const currentVersion = visible(pkg.currentVersion);
  return {
    ...pkg,
    formalVersion: visible(pkg.formalVersion),
    trialVersion: visible(pkg.trialVersion),
    trialVersions: pkg.trialVersions.filter((version) => visibleVersions.has(version)),
    currentVersion,
    currentVersionId: currentVersion === null ? null : pkg.currentVersionId,
    currentStatus: currentVersion === null ? null : pkg.currentStatus,
    inTestVersion: visible(pkg.inTestVersion),
    pendingTransferVersion: visible(pkg.pendingTransferVersion),
  };
}

export function getReadablePackageOverviewRows(user: SessionUser, projectId?: number) {
  const rows = getPackageOverviewRows(projectId);
  const versionIds = getReadableVersionIds(user);
  const packageIds = getReadablePackageIds(user, versionIds);
  if (versionIds === null || packageIds === null) return rows;
  const versions = new Map<number, Set<string>>();
  for (const { packageId, version } of all<{ packageId: number; version: string }>(
    `SELECT package_id AS packageId, version FROM package_versions WHERE id IN (SELECT value FROM json_each(?))`, JSON.stringify(versionIds),
  )) {
    const labels = versions.get(packageId) ?? new Set<string>();
    labels.add(version);
    versions.set(packageId, labels);
  }
  const readablePackages = new Set(packageIds);
  return rows.filter(({ id }) => readablePackages.has(id))
    .map((row) => restrictPackageSummary(row, versions.get(row.id) ?? new Set<string>()));
}

export function getReadablePackageDetail(user: SessionUser, packageId: number, projectId?: number): (PackageDetailData & { canEdit: boolean }) | null {
  const versionIds = getReadableVersionIds(user);
  const packageIds = getReadablePackageIds(user, versionIds);
  if (packageIds !== null && !packageIds.includes(packageId)) return null;
  const data = getPackageDetail(packageId, true, projectId);
  if (!data) return null;
  const canEdit = canEditPackageResponsibility(user, data.package.areaId);
  if (versionIds === null) return { ...data, canEdit };
  const versions = data.versions.filter((version) => versionIds.includes(version.id));
  const readableBatches = getReadableBatchEvidenceIds(user, versions.flatMap((version) => version.batchId ?? []));
  return {
    ...data,
    package: restrictPackageSummary(data.package, new Set(versions.map(({ version }) => version))),
    versions: versions.map((version) => version.batchId === null || readableBatches === null || readableBatches.has(version.batchId) ? version : {
      ...version, batchId: null, batchCode: null, batchStatus: null, batchConclusion: null,
    }),
    canEdit,
    audits: canEdit ? data.audits : [],
  };
}

export function getPackageDetail(packageId: number, includeInactive = false, projectId?: number): PackageDetailData | null {
  const [base] = projectId
    ? readPackageOverviewRows({ projectId, includeArchivedUsage: false, packageId })
    : withTrialProgress(readPackagesOverview(includeInactive, packageId));
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
        ) OR (${STANDALONE_VERSION_HISTORY_IN_PROJECT_SQL}))
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
