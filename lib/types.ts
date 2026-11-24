import type {
  BatchConclusion,
  BatchStatus,
  Role,
  IssueAttribution,
  PackageStatus,
  PackageProgressStatus,
} from "./constants";

export type SessionUser = {
  id: number;
  name: string;
  employeeId: string;
  role: Role;
  department: string;
  title: string;
};

export type PersonRef = {
  id: number;
  name: string;
  employeeId?: string;
  title?: string;
  role?: Role;
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

export type BatchItemSummary = {
  id: number;
  packageId: number;
  packageName: string;
  packageCode: string;
  packageVersionId: number;
  version: string;
  archiveUrl: string;
  changeSummary: string;
  isChanged: boolean;
  versionStatus: PackageStatus;
  ownerName: string | null;
};

export type BatchSummary = {
  id: number;
  code: string;
  title: string;
  status: BatchStatus;
  conclusion: BatchConclusion | null;
  issueAttribution: IssueAttribution | null;
  createdAt: string;
  sentAt: string | null;
  completedAt: string | null;
  terminatedAt: string | null;
  terminateReason: string | null;
  testSummary: string | null;
  testReportUrl: string | null;
  createdByName: string | null;
  itemCount: number;
  changedCount: number;
  pendingTrialCount: number;
  trialReleasedCount: number;
};

export type PendingReleaseVersion = {
  id: number;
  packageId: number;
  packageName: string;
  packageCode: string;
  version: string;
  changeSummary: string;
  archiveUrl: string;
  submittedByName: string | null;
  submittedAt: string;
  batchId: number;
  batchCode: string;
  batchConclusion: BatchConclusion;
  batchSummary: string | null;
  batchReportUrl: string | null;
  riskReviewId: number | null;
  riskReviewStatus: "PENDING" | "APPROVED" | "REJECTED" | null;
  riskReason: string | null;
  riskConclusion: string | null;
  ownerName: string | null;
  projectCount: number;
  nodeCount: number;
};

export type BindingTaskSummary = {
  id: number;
  projectId: number;
  projectName: string;
  projectCode: string;
  nodeId: number;
  nodeName: string;
  status: "PENDING" | "PASSED" | "FAILED";
  note: string;
  validatedByName: string | null;
  validatedAt: string | null;
};

export type TrialVersionSummary = {
  id: number;
  packageId: number;
  packageName: string;
  packageCode: string;
  version: string;
  trialReleasedAt: string;
  archiveUrl: string;
  changeSummary: string;
  ownerName: string | null;
  batchId: number;
  batchCode: string;
  totalTasks: number;
  passedTasks: number;
  failedTasks: number;
  projectCount: number;
};

export type ReviewSummary = {
  id: number;
  type: "RISK" | "FORMAL";
  status: "PENDING" | "APPROVED" | "REJECTED";
  reason: string;
  conclusion: string | null;
  createdAt: string;
  reviewedAt: string | null;
  requestedByName: string | null;
  reviewedByName: string | null;
  requestedById: number | null;
  reviewedById: number | null;
  packageVersionId: number;
  packageName: string;
  version: string;
  batchId: number | null;
  batchCode: string | null;
};