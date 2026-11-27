export const DEPARTMENT_NAME = process.env.NEXT_PUBLIC_DEPARTMENT_NAME || "软件工程部";
export const PRODUCT_NAME = "工程协同台";

export const ROLES = ["ADMIN", "MEMBER"] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_META: Record<Role, { label: string; description: string }> = {
  ADMIN: {
    label: "系统管理员",
    description: "维护账号、人员分工与基础数据，可办理各项目的流程。",
  },
  MEMBER: {
    label: "普通账号",
    description: "按项目、责任田、软件包和节点的分工查看资料并办理流程。",
  },
};

export const PACKAGE_STATUSES = [
  "PENDING_TRANSFER",
  "IN_TEST",
  "PENDING_TRIAL",
  "TRIAL",
  "PENDING_FORMAL",
  "FORMAL",
  "VOID",
] as const;

export type PackageStatus = (typeof PACKAGE_STATUSES)[number];

export const PACKAGE_STATUS_META: Record<
  PackageStatus,
  { label: string; tone: string }
> = {
  PENDING_TRANSFER: {
    label: "待转测",
    tone: "amber",
  },
  IN_TEST: {
    label: "集成测试中",
    tone: "sky",
  },
  PENDING_TRIAL: {
    label: "待发试制",
    tone: "violet",
  },
  TRIAL: {
    label: "试制验证中",
    tone: "teal",
  },
  PENDING_FORMAL: {
    label: "待转正",
    tone: "orange",
  },
  FORMAL: {
    label: "正式版本",
    tone: "emerald",
  },
  VOID: {
    label: "试制作废",
    tone: "slate",
  },
};

export const PACKAGE_PROGRESS_META = {
  ...PACKAGE_STATUS_META,
  WAITING_OTHER_ACCEPTANCE: { label: "待其他项目验收", tone: "amber" },
  WAITING_ACCEPTANCE: { label: "待验收确认", tone: "amber" },
  MISSING_TRANSFER_REQUEST: { label: "待补转测申请", tone: "amber" },
  RISK_TRIAL_READY: { label: "风险发布", tone: "rose" },
  TEST_PASSED: { label: "测试通过", tone: "emerald" },
  TEST_FAILED: { label: "测试不通过", tone: "rose" },
  TEST_BLOCKED: { label: "无法验证", tone: "amber" },
};

export type PackageProgressStatus = keyof typeof PACKAGE_PROGRESS_META;

export const BATCH_STATUSES = ["DRAFT", "IN_TEST", "COMPLETED", "TERMINATED"] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

export const BATCH_STATUS_META: Record<BatchStatus, { label: string; tone: string }> = {
  DRAFT: { label: "待发起", tone: "slate" },
  IN_TEST: { label: "集成测试中", tone: "sky" },
  COMPLETED: { label: "测试已完成", tone: "violet" },
  TERMINATED: { label: "已终止", tone: "rose" },
};

export const CONCLUSION_META = {
  PASS: { label: "测试通过", tone: "emerald" },
  FAIL: { label: "测试不通过", tone: "rose" },
  BLOCKED: { label: "无法完成验证", tone: "amber" },
} as const;

export type BatchConclusion = keyof typeof CONCLUSION_META;

export const ATTRIBUTION_META = {
  NONE: { label: "未发现问题", tone: "emerald" },
  PACKAGE_RELATED: { label: "问题与软件包相关", tone: "rose" },
  NOT_PACKAGE_RELATED: { label: "问题与软件包无关", tone: "amber" },
  UNKNOWN: { label: "原因待定位", tone: "slate" },
} as const;

export type IssueAttribution = keyof typeof ATTRIBUTION_META;

export const PROJECT_STATUS_META = {
  ACTIVE: { label: "进行中", tone: "emerald" },
  PAUSED: { label: "已暂停", tone: "amber" },
  ARCHIVED: { label: "已归档", tone: "slate" },
} as const;

export const TRANSFER_REQUEST_STATUS_META = {
  PENDING: { label: "待集成测试", tone: "amber" },
  IN_TEST: { label: "集成测试中", tone: "sky" },
  PASSED: { label: "测试通过", tone: "emerald" },
  FAILED: { label: "测试不通过", tone: "rose" },
  BLOCKED: { label: "无法验证", tone: "amber" },
  CANCELLED: { label: "已取消", tone: "slate" },
} as const;

export type TransferRequestStatus = keyof typeof TRANSFER_REQUEST_STATUS_META;

export const BINDING_FLOW_STATUS_META = {
  PENDING: { label: "待审批", tone: "amber" },
  APPROVED: { label: "审批通过", tone: "emerald" },
  REJECTED: { label: "审批驳回", tone: "rose" },
  CANCELLED: { label: "已撤销", tone: "slate" },
} as const;

export type BindingFlowStatus = keyof typeof BINDING_FLOW_STATUS_META;

export const BAD_CONCLUSION_LABEL: Record<string, string> = {
  FAILED: "集成测试不通过",
  BLOCKED: "无法完成验证",
};
