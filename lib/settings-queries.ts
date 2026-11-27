import "server-only";

import type { PackageStatus } from "./constants";
import { all, one } from "./db";
import { LEGACY_VERSION_IMPORT_SQL, STANDALONE_IMPORTED_VERSION_SQL } from "./version-scope";

export function getNodeApproverRemovalBlocker(userId: number, primaryApproverId: number | null, approverCount: number) {
  if (userId === primaryApproverId) {
    return { message: "主审批人不能从审批人范围移除，请先修改节点审批人。", target: "primary" } as const;
  }
  if (approverCount <= 1) {
    return { message: "节点至少需要保留一个审批人。", target: "range" } as const;
  }
  return null;
}

export function getSettingsPackageReferences(scope: { projectId: number } | { nodeId: number } | { enabledOwnerId: number }) {
  type Reference = { id: number; name: string; code: string; areaId: number | null; areaName: string | null };
  const packages = `SELECT DISTINCT p.id, p.name, p.code, p.area_id AS areaId, a.name AS areaName
    FROM packages p LEFT JOIN areas a ON a.id = p.area_id`;
  if ("enabledOwnerId" in scope) {
    return all<Reference>(`${packages} WHERE p.owner_id = ? AND p.is_active = 1 ORDER BY p.code, p.id`, scope.enabledOwnerId);
  }
  const [column, id] = "projectId" in scope ? ["project_id", scope.projectId] : ["node_id", scope.nodeId];
  return all<Reference>(`${packages} JOIN package_usages u ON u.package_id = p.id WHERE u.${column} = ? ORDER BY p.code, p.id`, id);
}

function countBindingHistory(column: "project_id" | "node_id", id: number) {
  return one<{ count: number }>(
    `SELECT (SELECT COUNT(*) FROM binding_requirements WHERE ${column} = ?)
            + (SELECT COUNT(*) FROM binding_tasks WHERE ${column} = ?)
            + (SELECT COUNT(*) FROM binding_flows WHERE ${column} = ?) AS count`,
    id, id, id,
  )?.count ?? 0;
}

export function getNodeDeletionBlockers(nodeId: number) {
  return {
    packages: getSettingsPackageReferences({ nodeId }),
    hasBindingHistory: countBindingHistory("node_id", nodeId) > 0,
  };
}

export function getProjectDeletionBlockers(projectId: number) {
  return {
    packages: getSettingsPackageReferences({ projectId }),
    batches: all<{ id: number; code: string }>(
      "SELECT id, code FROM integration_batches WHERE project_id = ? ORDER BY id DESC",
      projectId,
    ),
    hasBindingHistory: countBindingHistory("project_id", projectId) > 0,
  };
}

type PackageBlockingVersion = { id: number; version: string; status: PackageStatus; isStandaloneImport: number };

export function getPackageDeactivationBlockingVersions(packageId: number) {
  return all<PackageBlockingVersion>(
    `SELECT pv.id, pv.version, pv.status, (${STANDALONE_IMPORTED_VERSION_SQL}) AS isStandaloneImport
     FROM package_versions pv WHERE pv.package_id = ? AND pv.status != 'FORMAL'
     ORDER BY pv.submitted_at DESC, pv.id DESC`,
    packageId,
  );
}

export function getPackageUsageBlockingVersions(packageId: number) {
  return all<Pick<PackageBlockingVersion, "id" | "version" | "status">>(
    `SELECT pv.id, pv.version, pv.status FROM package_versions pv
     WHERE pv.package_id = ? AND pv.status IN ('TRIAL', 'PENDING_FORMAL')
       AND NOT ${STANDALONE_IMPORTED_VERSION_SQL}
     ORDER BY pv.submitted_at DESC, pv.id DESC`,
    packageId,
  );
}

// A referenced version may already be in a batch snapshot or binding history.
const CORRECTABLE_LEGACY_VERSION_SQL = `
  pv.status IN ('TRIAL', 'FORMAL')
  AND NOT EXISTS (SELECT 1 FROM version_transfer_requests r WHERE r.package_version_id = pv.id)
  AND NOT EXISTS (SELECT 1 FROM batch_items bi WHERE bi.package_version_id = pv.id)
  AND NOT EXISTS (SELECT 1 FROM binding_requirements br WHERE br.package_version_id = pv.id)
  AND NOT EXISTS (SELECT 1 FROM binding_tasks bt WHERE bt.package_version_id = pv.id)
  AND NOT EXISTS (SELECT 1 FROM binding_flows bf WHERE bf.package_version_id = pv.id)
  AND NOT EXISTS (SELECT 1 FROM trial_risk_admissions a WHERE a.package_version_id = pv.id)
  AND NOT EXISTS (SELECT 1 FROM risk_reviews rr WHERE rr.package_version_id = pv.id)
  AND NOT EXISTS (SELECT 1 FROM formal_reviews fr WHERE fr.package_version_id = pv.id)
`;

export function getImportedPackageVersions(packageId: number) {
  return all<{ id: number; version: string; status: PackageStatus; canCorrect: number }>(
    `SELECT pv.id, pv.version, pv.status, (${CORRECTABLE_LEGACY_VERSION_SQL}) AS canCorrect
     FROM package_versions pv
     WHERE pv.package_id = ? AND ${LEGACY_VERSION_IMPORT_SQL}
     ORDER BY pv.submitted_at DESC, pv.id DESC`,
    packageId,
  );
}

export type LegacyReleaseStatus = "TRIAL" | "FORMAL";

export type LegacyVersionMetadata = {
  changeSummary: string;
  archiveUrl: string;
  buildUrl: string;
  trialFormNo: string | null;
  trialReleasedAt: string | null;
  formFlowNo: string | null;
  formalReleasedAt: string | null;
};

type CorrectableLegacyVersion = LegacyVersionMetadata & {
  id: number;
  version: string;
  status: LegacyReleaseStatus;
  packageCode: string;
  packageName: string;
  updatedAt: string;
};

export function getLegacyVersionForCorrection(packageId: number, versionId: number) {
  return one<CorrectableLegacyVersion>(
    `SELECT pv.id, pv.version, pv.status, p.code AS packageCode, p.name AS packageName,
            pv.change_summary AS changeSummary, pv.archive_url AS archiveUrl, pv.build_url AS buildUrl,
            pv.trial_form_no AS trialFormNo, pv.trial_released_at AS trialReleasedAt,
            pv.form_flow_no AS formFlowNo, pv.formal_released_at AS formalReleasedAt, pv.updated_at AS updatedAt
     FROM package_versions pv JOIN packages p ON p.id = pv.package_id
     WHERE pv.id = ? AND pv.package_id = ? AND ${LEGACY_VERSION_IMPORT_SQL} AND ${CORRECTABLE_LEGACY_VERSION_SQL}`,
    versionId,
    packageId,
  );
}
