import "server-only";

import { canReadBatchEvidence } from "./access";
import type { BatchStatus } from "./constants";
import { all, one } from "./db";
import { packageIdentity } from "./package-identity";
import type { SessionUser } from "./types";

export type BatchComparisonCandidate = {
  id: number;
  code: string;
  title: string;
  status: BatchStatus;
  sentAt: string;
};

export type BatchComparisonCurrent = Omit<BatchComparisonCandidate, "sentAt"> & {
  projectId: number;
  projectName: string;
  sentAt: string | null;
  createdAt: string;
};

export type BatchComparisonChange = "added" | "removed" | "changed" | "same";

export type BatchComparisonRow = {
  packageId: number;
  packageCode: string;
  packageName: string;
  baseVersion: string | null;
  currentVersion: string | null;
  change: BatchComparisonChange;
};

export type BatchComparison = {
  current: BatchComparisonCurrent;
  candidates: BatchComparisonCandidate[];
  base: BatchComparisonCandidate | null;
  rows: BatchComparisonRow[];
  currentSnapshotAvailable: boolean;
  baseSnapshotAvailable: boolean | null;
};

type BatchSnapshotItem = {
  packageId: number;
  packageCode: string;
  packageName: string;
  versionId: number;
  version: string;
};

function getBatchSnapshot(batchId: number) {
  return all<BatchSnapshotItem>(
    `SELECT bi.package_id AS packageId, p.code AS packageCode, p.name AS packageName,
            bi.package_version_id AS versionId, bi.version
     FROM batch_items bi JOIN packages p ON p.id = bi.package_id
     WHERE bi.batch_id = ?`,
    batchId,
  );
}

function compareSnapshots(base: BatchSnapshotItem[], current: BatchSnapshotItem[]): BatchComparisonRow[] {
  const baseByPackage = new Map(base.map((item) => [item.packageId, item]));
  const currentByPackage = new Map(current.map((item) => [item.packageId, item]));
  const packages = new Map([...baseByPackage, ...currentByPackage]);
  const rows: BatchComparisonRow[] = [];

  for (const { packageId, packageCode, packageName } of packages.values()) {
    const before = baseByPackage.get(packageId);
    const after = currentByPackage.get(packageId);
    let change: BatchComparisonChange = "same";
    if (!before) change = "added";
    else if (!after) change = "removed";
    else if (before.versionId !== after.versionId) change = "changed";

    const identity = packageIdentity({ code: packageCode, name: packageName });
    rows.push({
      packageId,
      packageCode: identity.code,
      packageName: identity.name,
      baseVersion: before?.version ?? null,
      currentVersion: after?.version ?? null,
      change,
    });
  }

  return rows.sort((a, b) => a.packageCode.localeCompare(b.packageCode, undefined, { numeric: true }));
}

export function getBatchComparison(
  user: SessionUser,
  currentBatchId: number,
  selectedBaseId?: number,
): BatchComparison | null {
  const current = one<BatchComparisonCurrent>(
    `SELECT b.id, b.code, b.title, b.status, b.project_id AS projectId, p.name AS projectName,
            b.sent_at AS sentAt, b.created_at AS createdAt
     FROM integration_batches b JOIN projects p ON p.id = b.project_id
     WHERE b.id = ?`,
    currentBatchId,
  );
  if (!current || !canReadBatchEvidence(user, current.projectId, current.status)) return null;

  // Drafts are stricter than sent batches. All selectable bases share the current project's workflow read scope.
  const candidates = all<BatchComparisonCandidate>(
    `SELECT id, code, title, status, sent_at AS sentAt
     FROM integration_batches
     WHERE project_id = ? AND id != ? AND sent_at IS NOT NULL AND status IN ('IN_TEST','COMPLETED','TERMINATED')
     ORDER BY sent_at DESC, id DESC`,
    current.projectId,
    current.id,
  );

  const base = selectedBaseId === undefined
    ? candidates.find((candidate) => candidate.status !== "TERMINATED" && (
      current.status === "DRAFT"
      || (current.sentAt !== null && candidate.sentAt < current.sentAt)
      || (candidate.sentAt === current.sentAt && candidate.id < current.id)
    )) ?? null
    : candidates.find((candidate) => candidate.id === selectedBaseId) ?? null;
  if (selectedBaseId !== undefined && !base) return null;

  const currentItems = getBatchSnapshot(current.id);
  const baseItems = base ? getBatchSnapshot(base.id) : [];
  return {
    current,
    candidates,
    base,
    rows: currentItems.length > 0 && baseItems.length > 0 ? compareSnapshots(baseItems, currentItems) : [],
    currentSnapshotAvailable: currentItems.length > 0,
    baseSnapshotAvailable: base ? baseItems.length > 0 : null,
  };
}
