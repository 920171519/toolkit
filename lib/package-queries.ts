import "server-only";

import { all, one } from "./db";
import { canEditPackageResponsibility, getReadableBatchEvidenceIds, getReadablePackageIds, getReadablePackageVersionScope, getReadableVersionIds, getTransferAreaIds } from "./access";
import { STANDALONE_IMPORTED_VERSION_SQL, STANDALONE_VERSION_HISTORY_IN_PROJECT_SQL, STANDALONE_VERSION_IN_PROJECT_SQL } from "./version-scope";
import type { PackageProgressStatus } from "./constants";
import type { ProjectStatus } from "./domain-values";
import { getTrialProgress } from "./trial-eligibility";
import { packageCodeSql } from "./package-identity";
import { getPackageDeactivationBlockingVersions } from "./settings-queries";
import type { PackageSummary, PackageVersionSummary, SessionUser } from "./types";

const packageUsageFrom = `
  FROM package_usages u
  JOIN projects pr ON pr.id = u.project_id
  JOIN project_nodes n ON n.id = u.node_id
`;
const projectPackageUsages = `${packageUsageFrom} WHERE u.project_id = ?`;

const PACKAGE_CURRENT_VERSION_JOIN_SQL = `
  LEFT JOIN package_versions current_version ON current_version.id = (
    SELECT pv.id FROM package_versions pv
    WHERE pv.package_id = p.id AND pv.status NOT IN ('FORMAL','VOID')
      AND (pv.status != 'TRIAL' OR NOT ${STANDALONE_IMPORTED_VERSION_SQL})
    ORDER BY pv.updated_at DESC, pv.id DESC LIMIT 1
  )
`;

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
  ${PACKAGE_CURRENT_VERSION_JOIN_SQL}
`;

type PackageSelection = number | readonly number[];

function packageSelectionFilter(column: string, selection?: PackageSelection) {
  if (selection === undefined) return { condition: "", values: [] };
  if (typeof selection === "number") return { condition: `${column} = ?`, values: [selection] };
  return { condition: `${column} IN (SELECT value FROM json_each(?))`, values: [JSON.stringify(selection)] };
}

function packageOverviewSelection(selection?: PackageSelection, projectId?: number) {
  if (!projectId) return packageSelectionFilter("p.id", selection);
  const scope = packageSelectionFilter("u.package_id", selection);
  return {
    condition: `p.id IN (SELECT u.package_id ${projectPackageUsages}
      ${scope.condition ? `AND ${scope.condition}` : ""})`,
    values: [projectId, ...scope.values],
  };
}

function readPackagesOverview(
  includeInactive: boolean, selection?: PackageSelection, projectId?: number,
): { rows: PackageSummary[]; selection: PackageSelection | undefined } {
  const scope = packageOverviewSelection(selection, projectId);
  const conditions = [includeInactive ? "" : "p.is_active = 1", scope.condition].filter(Boolean);
  const packages = all<Omit<PackageSummary, "isActive" | "trialVersions"> & { isActive: number }>(
    `${PACKAGE_SUMMARY_SQL} ${conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`}
     ORDER BY ${packageCodeSql("p.name", "p.code")} COLLATE NOCASE, p.id`,
    ...scope.values,
  ).map((row) => ({
    ...row,
    isActive: Boolean(row.isActive),
  }));
  const included = projectId && typeof selection !== "number" ? packages.map(({ id }) => id) : selection;
  if (packages.length === 0) return { rows: [], selection: included };
  const trialScope = packageSelectionFilter("package_id", included);
  const trials = all<{ packageId: number; version: string }>(
    `SELECT package_id AS packageId, version FROM package_versions
     WHERE status IN ('TRIAL','PENDING_FORMAL')
       ${trialScope.condition ? `AND ${trialScope.condition}` : ""}
     ORDER BY package_id, trial_released_at DESC, id DESC`,
    ...trialScope.values,
  );
  const trialMap = new Map<number, string[]>();
  for (const trial of trials) {
    const list = trialMap.get(trial.packageId) ?? [];
    list.push(trial.version);
    trialMap.set(trial.packageId, list);
  }
  return {
    rows: packages.map((pkg) => ({
      ...pkg,
      trialVersions: trialMap.get(pkg.id) ?? [],
    })),
    selection: included,
  };
}

function withTrialProgress<T extends Pick<PackageSummary, "currentVersionId" | "currentStatus">>(packages: T[], projectId?: number): T[] {
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

function transferPackageFilter(user: SessionUser, projectId?: number) {
  const areaIds = getTransferAreaIds(user);
  if (areaIds?.length === 0) return null;
  return {
    where: `WHERE p.is_active = 1
     ${areaIds ? `AND p.area_id IN (${areaIds.map(() => "?").join(",")})` : ""}
     AND EXISTS (
       SELECT 1 FROM package_usages usage JOIN projects pr ON pr.id = usage.project_id
       WHERE usage.package_id = p.id AND pr.status != 'ARCHIVED' ${projectId ? "AND pr.id = ?" : ""}
     )`,
    values: [...(areaIds ?? []), ...(projectId ? [projectId] : [])],
  };
}

export function getTransferPackageOptions(user: SessionUser, projectId?: number) {
  const filter = transferPackageFilter(user, projectId);
  if (!filter) return [];
  return all<{ id: number; name: string; code: string; ownerName: string | null }>(
    `SELECT p.id, p.name, p.code, owner.name AS ownerName
     FROM packages p LEFT JOIN users owner ON owner.id = p.owner_id
     ${filter.where}
     ORDER BY ${packageCodeSql("p.name", "p.code")} COLLATE NOCASE, p.id`,
    ...filter.values,
  );
}

export function hasTransferPackageOptions(user: SessionUser, projectId?: number) {
  const filter = transferPackageFilter(user, projectId);
  return filter !== null && one(`SELECT 1 FROM packages p ${filter.where} LIMIT 1`, ...filter.values) !== undefined;
}


type PackageUsageScope = {
  projectId: number;
  projectName: string;
  projectCode: string;
  projectStatus: ProjectStatus;
  nodeNames: string[];
};

export type PackageOverviewRow = PackageSummary & {
  usages: PackageUsageScope[];
};

type PackageOverviewUsage = Omit<PackageUsageScope, "nodeNames"> & { packageId: number; nodeName: string };

function readPackageOverviewUsages(where: string, ...values: (string | number | null)[]) {
  return all<PackageOverviewUsage>(
    `SELECT u.package_id AS packageId, pr.id AS projectId, pr.name AS projectName,
            pr.code AS projectCode, pr.status AS projectStatus, n.name AS nodeName
     ${packageUsageFrom}
     WHERE ${where}
     ORDER BY pr.sort_order, n.sort_order, u.id`,
    ...values,
  );
}

function groupPackageOverviewUsages(usageRows: PackageOverviewUsage[]) {
  const usageMap = new Map<number, PackageUsageScope[]>();
  for (const row of usageRows) {
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
  return usageMap;
}

type PackageOverviewRequest = {
  packageId: number;
  versionId: number;
  version: string;
  status: string;
  formalReleasedAt: string | null;
  trialReleasedAt: string | null;
  updatedAt: string;
  standalone: number;
};

function readPackageOverviewRequests(
  projectId: number | undefined,
  packageCondition: string,
  packageValues: (number | string)[],
  releasesOnly = false,
) {
  return all<PackageOverviewRequest>(
    `SELECT pv.package_id AS packageId, pv.id AS versionId, pv.version, r.status,
            r.formal_released_at AS formalReleasedAt, r.trial_released_at AS trialReleasedAt,
            r.updated_at AS updatedAt, 0 AS standalone
     FROM version_transfer_requests r
     JOIN package_versions pv ON pv.id = r.package_version_id
     JOIN projects pr ON pr.id = r.project_id
     WHERE ${projectId ? "r.project_id = ?" : "pr.status != 'ARCHIVED'"} ${packageCondition}
     ${releasesOnly ? "AND r.status IN ('FORMAL','TRIAL','PENDING_FORMAL')" : ""}
     ${projectId ? `UNION ALL
       SELECT pv.package_id, pv.id, pv.version, pv.status, pv.formal_released_at,
              pv.trial_released_at, COALESCE(pv.formal_released_at, pv.trial_released_at, pv.updated_at), 1
       FROM package_versions pv WHERE ${STANDALONE_VERSION_IN_PROJECT_SQL} ${packageCondition}` : ""}
     ORDER BY updatedAt DESC, versionId DESC`,
    ...(projectId ? [projectId] : []),
    ...packageValues,
    ...(projectId ? [projectId, ...packageValues] : []),
  );
}

function packageOverviewReleaseLabels(requests: PackageOverviewRequest[], projectId?: number) {
  const formal = requests.filter((request) => request.status === "FORMAL");
  if (projectId) {
    formal.sort((first, second) =>
      (second.formalReleasedAt ?? second.updatedAt).localeCompare(first.formalReleasedAt ?? first.updatedAt),
    );
  }
  const trial = requests.filter((request) => request.status === "TRIAL" || request.status === "PENDING_FORMAL");
  return { formalVersion: formal[0]?.version, trialVersions: [...new Set(trial.map((request) => request.version))] };
}

export function getProjectPackagePreview(projectId: number, limit: number) {
  const packages = all<Pick<PackageSummary, "id" | "name" | "code" | "areaName"> & { total: number }>(
    `SELECT p.id, p.name, p.code, a.name AS areaName, COUNT(*) OVER() AS total
     FROM packages p
     JOIN (
       SELECT DISTINCT u.package_id ${projectPackageUsages}
     ) membership ON membership.package_id = p.id
     LEFT JOIN areas a ON a.id = p.area_id
     ORDER BY ${packageCodeSql("p.name", "p.code")} COLLATE NOCASE, p.id
     LIMIT ?`,
    projectId,
    limit,
  );
  if (packages.length === 0) return { total: 0, rows: [] };
  const ids = JSON.stringify(packages.map(({ id }) => id));
  const selectedIds = "SELECT value FROM json_each(?)";
  const usages = readPackageOverviewUsages(`u.package_id IN (${selectedIds})`, ids);
  const usageByPackage = groupPackageOverviewUsages(usages);
  const requests = readPackageOverviewRequests(projectId, `AND pv.package_id IN (${selectedIds})`, [ids], true);
  const requestsByPackage = Map.groupBy(requests, (request) => request.packageId);
  const rows = packages.map(({ id, name, code, areaName }) => {
    const { formalVersion, trialVersions } = packageOverviewReleaseLabels(requestsByPackage.get(id) ?? [], projectId);
    return { id, name, code, areaName, formalVersion: formalVersion ?? null, trialVersions, usages: usageByPackage.get(id) ?? [] };
  });
  return { total: packages[0].total, rows };
}

function readPackageOverviewRows(projectId?: number, selection?: PackageSelection): PackageOverviewRow[] {
  const { rows: packages, selection: included } = readPackagesOverview(true, selection, projectId);
  if (packages.length === 0) return [];
  const usageScope = packageSelectionFilter("u.package_id", included);
  const usageRows = readPackageOverviewUsages(
    `pr.status != 'ARCHIVED' ${usageScope.condition ? `AND ${usageScope.condition}` : ""}`,
    ...usageScope.values,
  );
  const usageMap = groupPackageOverviewUsages(usageRows);
  const requestScope = packageSelectionFilter("pv.package_id", included);
  const requestRows = readPackageOverviewRequests(
    projectId, requestScope.condition ? `AND ${requestScope.condition}` : "", requestScope.values,
  );
  const byPackage = Map.groupBy(requestRows, (request) => request.packageId);
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
    const { formalVersion, trialVersions } = packageOverviewReleaseLabels(requests, projectId);
    const current = requests.find((request) => !request.standalone && !["FORMAL", "VOID"].includes(request.status));
    const inTest = requests.find((request) => request.status === "IN_TEST");
    const pendingTransfer = requests.find((request) => request.status === "PENDING");
    const useAggregate = projectId === undefined && requests.length === 0;
    return {
      ...pkg,
      formalVersion: formalVersion ?? (projectId === undefined ? pkg.formalVersion : null),
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

export function getLegacyImportPackageOptions(areaIds: readonly number[] | null) {
  if (areaIds?.length === 0) return [];
  const scope = packageSelectionFilter("p.area_id", areaIds ?? undefined);
  return all<{ id: number; name: string; code: string }>(
    `SELECT p.id, p.name, p.code FROM packages p
     ${scope.condition ? `WHERE ${scope.condition}` : ""}
     ORDER BY ${packageCodeSql("p.name", "p.code")} COLLATE NOCASE, p.id`,
    ...scope.values,
  );
}

type PackageSettingsRow = Pick<PackageSummary,
  "id" | "name" | "code" | "isActive" | "areaId" | "areaName" | "ownerId" | "ownerName" | "ownerEmployeeId" | "currentStatus" | "currentVersionId"
> & {
  versionCount: number;
  usageCount: number;
};

export function getPackageSettingsDirectory(areaIds: readonly number[] | null) {
  if (areaIds?.length === 0) return [];
  const scope = packageSelectionFilter("p.area_id", areaIds ?? undefined);
  const rows = all<Omit<PackageSettingsRow, "isActive"> & { isActive: number }>(
    `SELECT p.id, p.name, p.code, p.is_active AS isActive,
            p.area_id AS areaId, a.name AS areaName, p.owner_id AS ownerId,
            o.name AS ownerName, o.employee_id AS ownerEmployeeId,
            current_version.status AS currentStatus, current_version.id AS currentVersionId,
            (SELECT COUNT(*) FROM package_versions v WHERE v.package_id = p.id) AS versionCount,
            (SELECT COUNT(*) FROM package_usages u WHERE u.package_id = p.id) AS usageCount
     FROM packages p
     LEFT JOIN areas a ON a.id = p.area_id
     LEFT JOIN users o ON o.id = p.owner_id
     ${PACKAGE_CURRENT_VERSION_JOIN_SQL}
     ${scope.condition ? `WHERE ${scope.condition}` : ""}
     ORDER BY ${packageCodeSql("p.name", "p.code")} COLLATE NOCASE, p.id`,
    ...scope.values,
  );
  return withTrialProgress(rows.map((row) => ({ ...row, isActive: Boolean(row.isActive) })));
}

type PackageDetailData = {
  package: PackageSummary;
  usages: Array<{
    projectId: number;
    projectName: string;
    projectCode: string;
    projectStatus: ProjectStatus;
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
  const versionIds = getReadableVersionIds(user);
  const packageIds = getReadablePackageIds(user, versionIds);
  if (versionIds === null || packageIds === null) return readPackageOverviewRows(projectId);
  if (packageIds.length === 0) return [];
  const rows = readPackageOverviewRows(projectId, packageIds);
  if (rows.length === 0) return rows;
  const labelScope = packageSelectionFilter("package_id", projectId ? rows.map(({ id }) => id) : undefined);
  const versions = new Map<number, Set<string>>();
  for (const { packageId, version } of all<{ packageId: number; version: string }>(
    `SELECT package_id AS packageId, version FROM package_versions
     WHERE id IN (SELECT value FROM json_each(?)) ${labelScope.condition ? `AND ${labelScope.condition}` : ""}`,
    JSON.stringify(versionIds), ...labelScope.values,
  )) {
    const labels = versions.get(packageId) ?? new Set<string>();
    labels.add(version);
    versions.set(packageId, labels);
  }
  return rows.map((row) => restrictPackageSummary(row, versions.get(row.id) ?? new Set<string>()));
}

function getReadablePackageDetail(user: SessionUser, packageId: number, projectId?: number): (PackageDetailData & { canEdit: boolean }) | null {
  const scope = getReadablePackageVersionScope(user, packageId);
  if (!scope) return null;
  const { versionIds } = scope;
  const pkg = projectId
    ? readPackageOverviewRows(projectId, packageId)[0]
    : readGlobalPackageSummary(packageId, true);
  if (!pkg) return null;

  const canEdit = canEditPackageResponsibility(user, pkg.areaId);
  const data = {
    package: pkg,
    usages: readPackageDetailUsages(packageId),
    versions: readPackageDetailVersions(packageId, projectId, versionIds),
    audits: versionIds === null || canEdit ? readPackageDetailAudits(packageId) : [],
    canEdit,
  };
  if (versionIds === null) return data;

  const { versions } = data;
  const readableBatches = getReadableBatchEvidenceIds(user, versions.flatMap((version) => version.batchId ?? []));
  return {
    ...data,
    package: restrictPackageSummary(pkg, new Set(versions.map(({ version }) => version))),
    versions: versions.map((version) => version.batchId === null || readableBatches === null || readableBatches.has(version.batchId) ? version : {
      ...version, batchId: null, batchCode: null, batchStatus: null, batchConclusion: null,
    }),
  };
}

export function getPackageDrawerData(user: SessionUser, packageId: number, projectId?: number) {
  const detail = getReadablePackageDetail(user, packageId, projectId);
  if (!detail) return null;

  return {
    ...detail,
    deactivationBlockers: detail.canEdit ? getPackageDeactivationBlockingVersions(packageId) : [],
  };
}

export type PackageDrawerData = NonNullable<ReturnType<typeof getPackageDrawerData>>;

function readGlobalPackageSummary(packageId: number, includeInactive: boolean) {
  const [pkg] = withTrialProgress(readPackagesOverview(includeInactive, packageId).rows);
  return pkg;
}

function readPackageDetailUsages(packageId: number): PackageDetailData["usages"] {
  const usageRows = all<{
    projectId: number;
    projectName: string;
    projectCode: string;
    projectStatus: ProjectStatus;
    nodeId: number;
    nodeName: string;
  }>(
    `SELECT pr.id AS projectId, pr.name AS projectName, pr.code AS projectCode, pr.status AS projectStatus,
            n.id AS nodeId, n.name AS nodeName
     ${packageUsageFrom}
     WHERE u.package_id = ? AND pr.status != 'ARCHIVED'
     ORDER BY pr.sort_order, n.sort_order`,
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
  return [...usageMap.values()];
}

export function getPackageConfiguration(packageId: number) {
  const pkg = readGlobalPackageSummary(packageId, true);
  return pkg ? { package: pkg, usages: readPackageDetailUsages(packageId) } : null;
}

function readPackageDetailVersions(packageId: number, projectId: number | undefined, versionIds: readonly number[] | null) {
  if (versionIds?.length === 0) return [];
  const scope = packageSelectionFilter("pv.id", versionIds ?? undefined);
  return all<PackageVersionSummary>(
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
        ${scope.condition ? `AND ${scope.condition}` : ""}
     ORDER BY pv.submitted_at DESC, pv.id DESC`,
    projectId ?? null, projectId ?? null,
    projectId ?? null, projectId ?? null,
    projectId ?? null, projectId ?? null,
    packageId,
    projectId ?? null, projectId ?? null, projectId ?? null,
    ...scope.values,
  ).map((version) => ({
    ...version,
    bindingTotal: Number(version.bindingTotal),
    bindingPassed: Number(version.bindingPassed),
    gateLabel: null,
    gateStatus: null,
  }));
}

function readPackageDetailAudits(packageId: number): PackageDetailData["audits"] {
  return all<{
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
}
