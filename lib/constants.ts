export const DEPARTMENT_NAME = process.env.NEXT_PUBLIC_DEPARTMENT_NAME || "软件工程部";
export const PRODUCT_NAME = "工程协同台";

export const ROLES = ["ADMIN", "MEMBER"] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_META: Record<Role, { label: string; short: string; description: string; tone: string }> = {
  ADMIN: {
    label: "系统管理员",
    short: "管理员",
    description: "维护账号、人员分工与基础数据，可办理各项目的流程。",
    tone: "violet",
  },
  MEMBER: {
    label: "普通账号",
    short: "成员",
    description: "按项目、责任田、软件包和节点的分工查看资料并办理流程。",
    tone: "slate",
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
  { label: string; description: string; tone: string; step: number }
> = {
  PENDING_TRANSFER: {
    label: "待转测",
    description: "责任人已提交申请，等待软件经理组织配套转测。",
    tone: "amber",
    step: 1,
  },
  IN_TEST: {
    label: "集成测试中",
    description: "已随配套送往集成测试，等待测试结论。",
    tone: "sky",
    step: 2,
  },
  PENDING_TRIAL: {
    label: "待发试制",
    description: "集成测试已完成，满足条件后可发布试制版本。",
    tone: "violet",
    step: 3,
  },
  TRIAL: {
    label: "试制验证中",
    description: "已发布试制版本，正在覆盖全部项目测试节点的绑定验证。",
    tone: "teal",
    step: 4,
  },
  PENDING_FORMAL: {
    label: "待转正",
    description: "绑定验证已全覆盖，等待转正评审与电子流发布。",
    tone: "orange",
    step: 5,
  },
  FORMAL: {
    label: "正式版本",
    description: "已完成转正，作为项目正式使用的版本。",
    tone: "emerald",
    step: 6,
  },
  VOID: {
    label: "试制作废",
    description: "绑定验证不通过，该试制版本已作废。",
    tone: "slate",
    step: 0,
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
  PASS: { label: "测试通过", tone: "emerald", description: "本项目验证通过。受影响的在行项目全部通过后，变更版本进入普通待发试制。" },
  FAIL: { label: "测试不通过", tone: "rose", description: "发现问题，变更包必须完成风险评审后才能发试制。" },
  BLOCKED: { label: "无法完成验证", tone: "amber", description: "缺少测试条件或测试未完成，变更包需风险评审。" },
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

export const AREA_COLOR_META: Record<string, { dot: string; soft: string; text: string; border: string }> = {
  amber: { dot: "#c27b19", soft: "#fbf2df", text: "#81510d", border: "#f0dfbe" },
  sky: { dot: "#2f6f9f", soft: "#eaf3fa", text: "#215a82", border: "#d3e5f1" },
  emerald: { dot: "#2d7a5e", soft: "#e8f4ee", text: "#1f5c46", border: "#cfe6da" },
  violet: { dot: "#7357a8", soft: "#f0ecf9", text: "#594184", border: "#e0d7f0" },
  rose: { dot: "#a94b63", soft: "#fbebee", text: "#823448", border: "#f0d4da" },
  teal: { dot: "#2d7d7c", soft: "#e7f4f3", text: "#215d5c", border: "#cce5e3" },
  slate: { dot: "#687169", soft: "#f0f1ee", text: "#4b544c", border: "#e1e4de" },
};

export const AREA_COLORS = ["amber", "sky", "emerald", "violet", "rose", "teal", "slate"] as const;

export const WEEKDAY_LABEL = "每周三 17:00";
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

export const BINDING_REQUIREMENT_STATUS_META = {
  PENDING: { label: "待绑定", tone: "amber" },
  PASSED: { label: "绑定通过", tone: "emerald" },
  CANCELLED: { label: "已取消", tone: "slate" },
} as const;

export const BAD_CONCLUSION_LABEL: Record<string, string> = {
  FAILED: "集成测试不通过",
  BLOCKED: "无法完成验证",
};
