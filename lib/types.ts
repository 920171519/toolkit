import type { PackageProgressStatus } from "./constants";
import type { BatchConclusion, BatchStatus, Role, PackageStatus } from "./domain-values";

export type SessionUser = {
  id: number;
  name: string;
  employeeId: string;
  role: Role;
  department: string;
  title: string;
};

export type PackageSummary = {
  id: number;
  name: string;
  code: string;
  description: string;
  isActive: boolean;
  areaId: number | null;
  areaName: string | null;
  areaColor: string | null;
  ownerId: number | null;
  ownerName: string | null;
  ownerEmployeeId: string | null;
  ownerTitle: string | null;
  trialOverdueDays: number;
  formalVersion: string | null;
  trialVersion: string | null;
  trialVersions: string[];
  currentVersion: string | null;
  currentStatus: PackageProgressStatus | null;
  currentVersionId: number | null;
  inTestVersion: string | null;
  pendingTransferVersion: string | null;
};

export type PackageVersionSummary = {
  id: number;
  packageId: number;
  packageName: string;
  packageCode: string;
  version: string;
  changeSummary: string;
  archiveUrl: string;
  buildUrl: string | null;
  voidKind: string | null;
  status: PackageStatus;
  submittedAt: string;
  submittedById: number | null;
  submittedByName: string | null;
  trialReleasedAt: string | null;
  formalReleasedAt: string | null;
  formFlowNo: string | null;
  batchId: number | null;
  batchCode: string | null;
  batchStatus: BatchStatus | null;
  batchConclusion: BatchConclusion | null;
  riskReviewStatus: string | null;
  formalReviewStatus: string | null;
  bindingTotal: number;
  bindingPassed: number;
  ownerName: string | null;
};
