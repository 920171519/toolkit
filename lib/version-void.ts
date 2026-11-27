import "server-only";

import { versionProjectManagementBlocker } from "./access";
import { one } from "./db";
import type { SessionUser } from "./types";

export type ManualVersionVoidKind = "FORMAL" | "TRIAL" | "ABANDON";

function manualVoidKind(status: string, admitted: number): ManualVersionVoidKind | null {
  if (status === "FORMAL") return "FORMAL";
  if (status === "TRIAL" || status === "PENDING_FORMAL") return "TRIAL";
  if (status === "PENDING_TRIAL" || (admitted && (status === "PENDING_TRANSFER" || status === "IN_TEST"))) return "ABANDON";
  return null;
}

export function getVersionForVoid(versionId: number) {
  const row = one<{ status: string; packageId: number; packageName: string; version: string; admitted: number }>(
    `SELECT pv.status, p.id AS packageId, p.name AS packageName, pv.version,
            EXISTS (SELECT 1 FROM trial_risk_admissions a
                    WHERE a.package_version_id = pv.id AND a.invalidated_at IS NULL) AS admitted
     FROM package_versions pv JOIN packages p ON p.id = pv.package_id WHERE pv.id = ?`,
    versionId,
  );
  if (!row) return undefined;
  const { status, admitted, ...version } = row;
  return { ...version, kind: manualVoidKind(status, admitted) };
}

export function canVoidPackageVersion(user: SessionUser, versionId: number) {
  const version = getVersionForVoid(versionId);
  return Boolean(version?.kind) && versionProjectManagementBlocker(user, versionId) === null;
}

export function hasVersionRequest(requestId: number, versionId: number): boolean {
  return Boolean(one(
    "SELECT id FROM version_transfer_requests WHERE id = ? AND package_version_id = ?",
    requestId, versionId,
  ));
}
