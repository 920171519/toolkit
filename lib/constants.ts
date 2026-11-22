export const DEPARTMENT_NAME = process.env.NEXT_PUBLIC_DEPARTMENT_NAME || "软件工程部";
export const PRODUCT_NAME = "工程协同台";

export const ROLES = [
  "ADMIN",
  "SOFTWARE_MANAGER",
  "INTEGRATION_TESTER",
  "REVIEWER",
  "PACKAGE_OWNER",
  "TEST_VALIDATOR",
  "MEMBER",
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_META: Record<Role, { label: string; short: string; description: string; tone: string }> = {
  ADMIN: {
    label: "系统管理员",
    short: "管理员",
    description: "维护人员、角色与全部基础数据，拥有所有操作权限。",
    tone: "violet",
  },
  SOFTWARE_MANAGER: {
    label: "软件经理",
    short: "软件经理",
    description: "维护所负责的项目和节点，组织项目转测、试制与转正。",
    tone: "amber",
  },
  INTEGRATION_TESTER: {
    label: "集成测试",
    short: "集成测试",
    description: "接收配套转测，填写测试结论与验证报告。",
    tone: "sky",
  },
  REVIEWER: {
    label: "评审专家",
    short: "评审专家",
    description: "评审角色预留，具体评审规则将在后续需求明确后重新接入。",
    tone: "rose",
  },
  PACKAGE_OWNER: {
    label: "软件包责任人",
    short: "责任人",
    description: "按责任田分工提交软件包的转测申请和版本信息。",
    tone: "emerald",
  },
  TEST_VALIDATOR: {
    label: "绑定验证员",
    short: "验证员",
    description: "逐个项目测试节点记录绑定验证结果。",
    tone: "teal",
  },
  MEMBER: {
    label: "部门成员",
    short: "成员",
    description: "可查看部门公开信息与内部工程数据。",
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

export const BATCH_STATUSES = ["DRAFT", "IN_TEST", "COMPLETED", "TERMINATED"] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

export const BATCH_STATUS_META: Record<BatchStatus, { label: string; tone: string }> = {
  DRAFT: { label: "待发起", tone: "slate" },
  IN_TEST: { label: "集成测试中", tone: "sky" },
  COMPLETED: { label: "测试已完成", tone: "violet" },
  TERMINATED: { label: "已终止", tone: "rose" },
};

export const CONCLUSION_META = {
  PASS: { label: "测试通过", tone: "emerald", description: "验证无问题，配套内的变更包可正常发布试制。" },
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

export const REVIEW_STATUS_META = {
  PENDING: { label: "待评审", tone: "amber" },
  APPROVED: { label: "评审通过", tone: "emerald" },
  REJECTED: { label: "评审驳回", tone: "rose" },
} as const;

export const BINDING_STATUS_META = {
  PENDING: { label: "待验证", tone: "amber" },
  PASSED: { label: "验证通过", tone: "emerald" },
  FAILED: { label: "验证不通过", tone: "rose" },
} as const;

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
