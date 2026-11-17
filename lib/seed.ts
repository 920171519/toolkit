import type { DatabaseSync } from "node:sqlite";
import { hashPassword } from "./password";

export const DEMO_PASSWORD = "Demo@1234";

const iso = (value: string) => new Date(value).toISOString();
const archive = (code: string, version: string) =>
  `https://packages.example.com/releases/${code.toLowerCase()}/${version}/${code.toLowerCase()}-${version}.tar.gz`;

type VersionStatus =
  | "PENDING_TRANSFER"
  | "IN_TEST"
  | "PENDING_TRIAL"
  | "TRIAL"
  | "PENDING_FORMAL"
  | "FORMAL"
  | "VOID";

type VersionSeed = {
  id: number;
  packageId: number;
  version: string;
  summary: string;
  archiveUrl: string;
  status: VersionStatus;
};

export function seedDatabase(db: DatabaseSync) {
  const existing = db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
  if (Number(existing.count) > 0) return;

  db.exec("BEGIN");
  try {
    seedAll(db);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function seedAll(db: DatabaseSync) {
  const insertUser = db.prepare(
    `INSERT INTO users (name, employee_id, password_hash, role, department, title, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const passwordHash = hashPassword(DEMO_PASSWORD);
  const userSeeds = [
    ["张启明", "ADMIN001", "ADMIN", "平台管理员"],
    ["林澈", "MGR001", "SOFTWARE_MANAGER", "软件经理"],
    ["周宁", "TEST001", "INTEGRATION_TESTER", "集成测试工程师"],
    ["王磊", "OWNER001", "PACKAGE_OWNER", "系统架构师"],
    ["陈曦", "OWNER002", "PACKAGE_OWNER", "通信软件专家"],
    ["赵敏", "OWNER003", "PACKAGE_OWNER", "安全软件专家"],
    ["韩松", "VALID001", "TEST_VALIDATOR", "硬件验证工程师"],
    ["许言", "MEMBER001", "MEMBER", "项目质量工程师"],
    ["郑一", "OWNER004", "PACKAGE_OWNER", "工具链负责人"],
    ["沈清", "MGR002", "SOFTWARE_MANAGER", "软件经理"],
    ["唐雅", "MGR003", "SOFTWARE_MANAGER", "软件经理"],
    ["何欣", "TEST002", "INTEGRATION_TESTER", "集成测试工程师"],
    ["程野", "TEST003", "INTEGRATION_TESTER", "集成测试工程师"],
  ] as const;
  const createdAt = iso("2026-09-01T09:00:00+08:00");
  const userIds: Record<string, number> = {};
  for (const [name, employeeId, role, title] of userSeeds) {
    const result = insertUser.run(
      name,
      employeeId,
      passwordHash,
      role,
      "软件工程部",
      title,
      createdAt,
    );
    userIds[employeeId] = Number(result.lastInsertRowid);
  }
  const [admin, manager, tester, wangLei, chenXi, zhaoMin, hanSong, xuYan, zhengYi, manager2, manager3, tester2, tester3] = [
    userIds.ADMIN001,
    userIds.MGR001,
    userIds.TEST001,
    userIds.OWNER001,
    userIds.OWNER002,
    userIds.OWNER003,
    userIds.VALID001,
    userIds.MEMBER001,
    userIds.OWNER004,
    userIds.MGR002,
    userIds.MGR003,
    userIds.TEST002,
    userIds.TEST003,
  ];

  const insertArea = db.prepare(
    "INSERT INTO areas (name, description, is_integration, created_at) VALUES (?, ?, ?, ?)",
  );
  const areaSeeds = [
    ["系统底座", "负责系统升级、配置、设备管理与媒体基础能力，保障版本从设备到云端的稳定交付。", 0],
    ["通信互联", "负责设备间通信、网络协同与连接体验，覆盖多项目全生命周期。", 0],
    ["安全可信", "负责安全启动、密钥与设备身份体系，是版本合规与生产准入的关键责任田。", 0],
    ["质量与工具", "负责诊断工具、验证平台和工程效率建设，为项目提供测试与定位能力。", 0],
    ["集成测试", "负责项目维度集成测试计划、验证执行与测试结论提交，按项目配置测试负责人。", 1],
  ] as const;
  const areaIds: number[] = [];
  for (const [name, description, isIntegration] of areaSeeds) {
    const result = insertArea.run(name, description, isIntegration, createdAt);
    areaIds.push(Number(result.lastInsertRowid));
  }

  const insertAreaLeader = db.prepare(
    "INSERT INTO area_leaders (area_id, user_id, created_at) VALUES (?, ?, ?)",
  );
  const areaLeaderSeeds = [
    [areaIds[0], wangLei],
    [areaIds[1], chenXi],
    [areaIds[2], zhaoMin],
    [areaIds[3], zhengYi],
    [areaIds[4], tester],
    [areaIds[4], tester3],
  ];
  for (const [areaId, userId] of areaLeaderSeeds) {
    insertAreaLeader.run(areaId, userId, createdAt);
  }

  const insertProject = db.prepare(
    `INSERT INTO projects
      (name, code, description, pm_user_id, software_manager_id, status, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const projectSeeds = [
    ["星云 N1", "N1", "旗舰移动终端平台，面向高端旗舰档位交付。", wangLei, manager, "ACTIVE", 1],
    ["极光 M2", "M2", "轻量穿戴与多设备协同平台，强调低功耗连接。", chenXi, manager2, "ACTIVE", 2],
    ["磐石 T3", "T3", "行业加固终端平台，生产验证与合规要求严格。", zhaoMin, manager3, "ACTIVE", 3],
    ["远山 X0", "X0", "已结束的行业终端项目，保留项目软件包使用情况供后续追溯。", xuYan, manager, "ARCHIVED", 4],
  ] as const;
  const projectIds: number[] = [];
  for (const [name, code, description, pm, softwareManager, status, sortOrder] of projectSeeds) {
    const result = insertProject.run(name, code, description, pm, softwareManager, status, sortOrder, createdAt);
    projectIds.push(Number(result.lastInsertRowid));
  }

  const insertProjectPm = db.prepare(
    "INSERT INTO project_pms (project_id, user_id, created_at) VALUES (?, ?, ?)",
  );
  const insertProjectManager = db.prepare(
    "INSERT INTO project_software_managers (project_id, user_id, created_at) VALUES (?, ?, ?)",
  );
  for (let index = 0; index < projectIds.length; index += 1) {
    const [, , , pm, softwareManager] = projectSeeds[index];
    insertProjectPm.run(projectIds[index], pm, createdAt);
    insertProjectManager.run(projectIds[index], softwareManager, createdAt);
  }

  const insertAreaProjectLead = db.prepare(
    `INSERT INTO area_project_leads (area_id, project_id, user_id, created_at)
     VALUES (?, ?, ?, ?)`,
  );
  const areaProjectLeadSeeds = [
    [areaIds[0], projectIds[0], wangLei],
    [areaIds[0], projectIds[1], wangLei],
    [areaIds[0], projectIds[3], wangLei],
    [areaIds[1], projectIds[0], chenXi],
    [areaIds[1], projectIds[1], chenXi],
    [areaIds[1], projectIds[2], chenXi],
    [areaIds[2], projectIds[0], zhaoMin],
    [areaIds[2], projectIds[2], zhaoMin],
    [areaIds[3], projectIds[0], tester],
    [areaIds[3], projectIds[1], tester2],
    [areaIds[3], projectIds[2], tester3],
    [areaIds[4], projectIds[0], tester],
    [areaIds[4], projectIds[1], tester2],
    [areaIds[4], projectIds[2], tester3],
  ];
  for (const [areaId, projectId, userId] of areaProjectLeadSeeds) {
    insertAreaProjectLead.run(areaId, projectId, userId, createdAt);
  }

  const insertAreaMember = db.prepare(
    "INSERT INTO area_project_members (area_id, project_id, user_id, created_at) VALUES (?, ?, ?, ?)",
  );
  const areaMemberSeeds = [
    [areaIds[0], projectIds[0], hanSong],
    [areaIds[0], projectIds[1], chenXi],
    [areaIds[1], projectIds[0], manager2],
    [areaIds[1], projectIds[1], manager2],
    [areaIds[2], projectIds[0], wangLei],
    [areaIds[3], projectIds[0], tester3],
    [areaIds[4], projectIds[0], tester3],
  ];
  for (const [areaId, projectId, userId] of areaMemberSeeds) {
    insertAreaMember.run(areaId, projectId, userId, createdAt);
  }

  const insertNode = db.prepare(
    `INSERT INTO project_nodes
      (project_id, name, description, binding_owner_id, binding_approver_id, required_binding_count, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const nodesByProject: number[][] = [];
  const nodeNames = ["EVT", "DVT", "PVT"];
  const nodeDescriptions = ["工程验证", "设计验证", "生产验证"];
  const projectApprovers = [wangLei, chenXi, zhaoMin, xuYan];
  const projectManagers = [manager, manager2, manager3, manager];
  const insertNodeApprover = db.prepare(
    "INSERT INTO project_node_approvers (node_id, user_id, created_at) VALUES (?, ?, ?)",
  );
  projectIds.forEach((projectId, projectIndex) => {
    const nodeIds: number[] = [];
    nodeNames.forEach((name, index) => {
      const result = insertNode.run(
        projectId,
        name,
        nodeDescriptions[index],
        hanSong,
        projectApprovers[projectIndex],
        1,
        index + 1,
      );
      const nodeId = Number(result.lastInsertRowid);
      nodeIds.push(nodeId);
      insertNodeApprover.run(nodeId, projectApprovers[projectIndex], createdAt);
      insertNodeApprover.run(nodeId, projectManagers[projectIndex], createdAt);
    });
    nodesByProject.push(nodeIds);
  });
  const [n1Nodes, m2Nodes, t3Nodes, x0Nodes] = nodesByProject;

  const insertPackage = db.prepare(
    `INSERT INTO packages (name, code, description, area_id, owner_id, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
  );
  const packageSeeds = [
    ["1001OTA", "OTA", "OTA 升级服务：端到端系统升级、灰度与回滚能力。", areaIds[0], wangLei],
    ["1002CFG", "CFG", "设备配置中心：配置下发、生效与一致性管理。", areaIds[0], wangLei],
    ["1003COM", "COM", "通信总线：进程间与服务间统一通信框架。", areaIds[1], chenXi],
    ["1004NET", "NET", "网络协同服务：多设备网络协同、链路切换与连接保持。", areaIds[1], chenXi],
    ["1005SEC", "SEC", "安全启动引擎：启动链校验、安全状态与防回滚能力。", areaIds[2], zhaoMin],
    ["1006KEY", "KEY", "密钥管理服务：设备密钥生命周期与证书安全管理。", areaIds[2], zhaoMin],
    ["1007DIA", "DIA", "诊断工具链：设备日志、诊断命令与问题定位工具。", areaIds[3], zhengYi],
    ["1008MED", "MED", "媒体编解码组件：音视频硬件编解码与媒体能力封装。", areaIds[0], wangLei],
  ] as const;
  const packageIds: number[] = [];
  const codeToId = new Map<string, number>();
  for (const [name, code, description, areaId, ownerId] of packageSeeds) {
    const result = insertPackage.run(name, code, description, areaId, ownerId, createdAt);
    const id = Number(result.lastInsertRowid);
    packageIds.push(id);
    codeToId.set(code, id);
  }

  const insertUsage = db.prepare(
    "INSERT INTO package_usages (package_id, project_id, node_id) VALUES (?, ?, ?)",
  );
  const usageByProjectNode: Record<string, number[]> = {
    OTA: [n1Nodes[0], n1Nodes[1], n1Nodes[2], m2Nodes[2], x0Nodes[0], x0Nodes[2]],
    CFG: [n1Nodes[0], n1Nodes[2], t3Nodes[0], t3Nodes[1], t3Nodes[2]],
    COM: [n1Nodes[1], n1Nodes[2], m2Nodes[0], m2Nodes[1], m2Nodes[2], t3Nodes[0], t3Nodes[2], x0Nodes[1], x0Nodes[2]],
    NET: [n1Nodes[0], n1Nodes[1], n1Nodes[2], m2Nodes[0], m2Nodes[1], m2Nodes[2], t3Nodes[0], t3Nodes[1]],
    SEC: [n1Nodes[0], n1Nodes[2], m2Nodes[0], m2Nodes[2], t3Nodes[0], t3Nodes[1], t3Nodes[2]],
    KEY: [n1Nodes[0], n1Nodes[2], m2Nodes[0], m2Nodes[2], t3Nodes[0], t3Nodes[2]],
    DIA: [n1Nodes[1], n1Nodes[2], m2Nodes[1], t3Nodes[0], t3Nodes[1]],
    MED: [n1Nodes[0], n1Nodes[1], n1Nodes[2], m2Nodes[0], m2Nodes[1], t3Nodes[2], x0Nodes[0], x0Nodes[2]],
  };
  for (const [code, nodeIds] of Object.entries(usageByProjectNode)) {
    const packageId = codeToId.get(code);
    if (!packageId) continue;
    for (const nodeId of nodeIds) {
      const projectIndex = nodesByProject.findIndex((nodes) => nodes.includes(nodeId));
      insertUsage.run(packageId, projectIds[projectIndex], nodeId);
    }
  }

  const insertVersion = db.prepare(
    `INSERT INTO package_versions
      (package_id, version, change_summary, archive_url, status, submitted_by, submitted_at,
       trial_form_no, trial_released_at, formal_released_at, form_flow_no, void_reason, voided_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const addVersion = (
    code: string,
    version: string,
    summary: string,
    status: VersionStatus,
    submittedAt: string,
    submittedBy: number,
    options: {
      trialFormNo?: string;
      trialReleasedAt?: string;
      formalReleasedAt?: string;
      formFlowNo?: string;
      voidReason?: string;
      voidedAt?: string;
    } = {},
  ): VersionSeed => {
    const packageId = codeToId.get(code);
    if (!packageId) throw new Error(`Unknown package ${code}`);
    const archiveUrl = archive(code, version);
    const result = insertVersion.run(
      packageId,
      version,
      summary,
      archiveUrl,
      status,
      submittedBy,
      iso(submittedAt),
      options.trialFormNo ?? null,
      options.trialReleasedAt ? iso(options.trialReleasedAt) : null,
      options.formalReleasedAt ? iso(options.formalReleasedAt) : null,
      options.formFlowNo ?? null,
      options.voidReason ?? null,
      options.voidedAt ? iso(options.voidedAt) : null,
      iso(submittedAt),
    );
    return {
      id: Number(result.lastInsertRowid),
      packageId,
      version,
      summary,
      archiveUrl,
      status,
    };
  };

  const formalVersions = new Map<string, VersionSeed>();
  const formalSeed: Array<[string, string, string, string]> = [
    ["OTA", "1.5.2", "修复升级断电后恢复异常，优化差分包下载耗时。", "2026-09-18T10:00:00+08:00"],
    ["CFG", "2.2.0", "支持多产品配置模板，修复配置回读不一致问题。", "2026-09-22T14:00:00+08:00"],
    ["COM", "2.0.3", "修复高负载下消息堆积，新增链路健康度指标。", "2026-09-26T09:30:00+08:00"],
    ["NET", "1.4.0", "优化跨设备连接切换，修复休眠唤醒后重连慢问题。", "2026-10-08T16:00:00+08:00"],
    ["SEC", "1.3.1", "修复安全状态上报时序问题，增强防回滚校验。", "2026-09-29T11:00:00+08:00"],
    ["KEY", "1.2.4", "支持密钥轮换审计，修复证书链校验边界问题。", "2026-10-10T15:00:00+08:00"],
    ["DIA", "3.0.0", "统一诊断命令模型，提升日志采集稳定性。", "2026-09-20T10:00:00+08:00"],
    ["MED", "4.1.0", "新增低时延解码模式，修复多路并发偶发花屏。", "2026-09-25T13:00:00+08:00"],
  ];
  const ownerByCode: Record<string, number> = {
    OTA: wangLei,
    CFG: wangLei,
    COM: chenXi,
    NET: chenXi,
    SEC: zhaoMin,
    KEY: zhaoMin,
    DIA: zhengYi,
    MED: wangLei,
  };
  for (const [code, version, summary, releasedAt] of formalSeed) {
    formalVersions.set(
      code,
      addVersion(code, version, summary, "FORMAL", releasedAt, ownerByCode[code] ?? wangLei, {
        trialReleasedAt: releasedAt,
        formalReleasedAt: releasedAt,
        formFlowNo: `EF-${code}-${version.replaceAll(".", "")}`,
      }),
    );
  }

  const otaTrial = addVersion("OTA", "1.6.0", "新增断点续传与灰度批次控制，修复弱网下升级包校验失败问题。", "PENDING_TRIAL", "2026-11-05T09:30:00+08:00", wangLei);
  const commPending = addVersion("COM", "2.1.0", "新增可靠广播通道，修复跨进程大消息分片乱序问题。", "PENDING_TRANSFER", "2026-11-12T10:20:00+08:00", chenXi);
  const netsyncFormal = addVersion("NET", "2.0.0", "重构多设备网络协同状态机，新增链路质量自适应策略。", "PENDING_FORMAL", "2026-11-03T09:10:00+08:00", chenXi, {
    trialFormNo: "EF-TRIAL-NET-200",
    trialReleasedAt: "2026-11-09T17:00:00+08:00",
  });
  const secbootPending = addVersion("SEC", "1.4.0", "新增安全启动度量上报，修复特定芯片平台签名校验超时问题。", "PENDING_TRANSFER", "2026-11-13T14:10:00+08:00", zhaoMin);
  const keystoreTrial = addVersion("KEY", "1.3.0", "支持双密钥并行轮换，完善证书吊销状态缓存机制。", "TRIAL", "2026-11-04T11:30:00+08:00", zhaoMin, {
    trialFormNo: "EF-TRIAL-KEY-130",
    trialReleasedAt: "2026-11-11T18:00:00+08:00",
  });
  const diagInTest = addVersion("DIA", "3.0.1", "修复长时间采集内存增长问题，新增设备侧诊断快照。", "IN_TEST", "2026-11-11T10:00:00+08:00", zhengYi);
  const mediaInTest = addVersion("MED", "4.2.0", "新增 AV1 硬件解码能力，修复 4K 播放切换时花屏问题。", "IN_TEST", "2026-11-02T15:20:00+08:00", wangLei);

  const insertRequest = db.prepare(
    `INSERT INTO version_transfer_requests
      (package_version_id, project_id, status, trial_form_no, trial_released_at, trial_released_by,
       formal_released_at, formal_released_by, form_flow_no, void_reason, voided_at, submitted_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const requests = new Map<string, { id: number; status: string }>();
  const addRequest = (
    version: VersionSeed,
    projectId: number,
    status: string,
    options: {
      trialFormNo?: string;
      trialReleasedAt?: string;
      trialReleasedBy?: number;
      formalReleasedAt?: string;
      formalReleasedBy?: number;
      formFlowNo?: string;
      submittedAt?: string;
      updatedAt?: string;
    } = {},
  ) => {
    const result = insertRequest.run(
      version.id,
      projectId,
      status,
      options.trialFormNo ?? null,
      options.trialReleasedAt ? iso(options.trialReleasedAt) : null,
      options.trialReleasedBy ?? null,
      options.formalReleasedAt ? iso(options.formalReleasedAt) : null,
      options.formalReleasedBy ?? null,
      options.formFlowNo ?? null,
      null,
      null,
      iso(options.submittedAt ?? "2026-11-05T09:00:00+08:00"),
      iso(options.updatedAt ?? "2026-11-13T09:00:00+08:00"),
    );
    requests.set(`${version.id}:${projectId}`, { id: Number(result.lastInsertRowid), status });
  };

  // 已转正的历史版本在每个在行项目下都有一条已完成的版本记录
  for (const [code, version] of formalVersions) {
    const nodeIds = usageByProjectNode[code];
    if (!nodeIds) continue;
    for (const projectIndex of [0, 1, 2]) {
      if (!nodeIds.some((nodeId) => nodesByProject[projectIndex].includes(nodeId))) continue;
      addRequest(version, projectIds[projectIndex], "FORMAL", {
        trialFormNo: `EF-TRIAL-${code}-${version.version.replaceAll(".", "")}`,
        trialReleasedAt: "2026-10-01T10:00:00+08:00",
        trialReleasedBy: projectIndex === 0 ? manager : projectIndex === 1 ? manager2 : manager3,
        formalReleasedAt: "2026-10-08T10:00:00+08:00",
        formalReleasedBy: projectIndex === 0 ? manager : projectIndex === 1 ? manager2 : manager3,
        formFlowNo: `EF-${code}-${version.version.replaceAll(".", "")}`,
        submittedAt: "2026-09-20T10:00:00+08:00",
        updatedAt: "2026-10-08T10:00:00+08:00",
      });
    }
  }

  addRequest(otaTrial, projectIds[0], "PASSED", { updatedAt: "2026-11-10T18:10:00+08:00" });
  addRequest(otaTrial, projectIds[1], "PASSED", { updatedAt: "2026-11-11T15:00:00+08:00" });
  addRequest(netsyncFormal, projectIds[0], "PENDING_FORMAL", {
    trialFormNo: "EF-TRIAL-NET-200",
    trialReleasedAt: "2026-11-09T17:00:00+08:00",
    trialReleasedBy: manager,
    updatedAt: "2026-11-14T10:00:00+08:00",
  });
  addRequest(netsyncFormal, projectIds[1], "PASSED");
  addRequest(netsyncFormal, projectIds[2], "PASSED");
  addRequest(keystoreTrial, projectIds[0], "TRIAL", {
    trialFormNo: "EF-TRIAL-KEY-130",
    trialReleasedAt: "2026-11-11T18:00:00+08:00",
    trialReleasedBy: manager,
    updatedAt: "2026-11-14T10:00:00+08:00",
  });
  addRequest(keystoreTrial, projectIds[1], "PASSED");
  addRequest(keystoreTrial, projectIds[2], "PASSED");
  for (const projectId of [0, 1, 2]) {
    addRequest(commPending, projectIds[projectId], "PENDING");
    addRequest(secbootPending, projectIds[projectId], "PENDING");
  }
  addRequest(diagInTest, projectIds[0], "IN_TEST");
  addRequest(diagInTest, projectIds[1], "PENDING");
  addRequest(diagInTest, projectIds[2], "PENDING");
  addRequest(mediaInTest, projectIds[0], "PENDING");
  addRequest(mediaInTest, projectIds[1], "IN_TEST");
  addRequest(mediaInTest, projectIds[2], "FAILED");

  const packagesByProject = projectIds.map((projectId) =>
    packageSeeds
      .filter(([, code]) =>
        Object.values(usageByProjectNode).some((nodeIds) =>
          nodeIds.some((nodeId) => nodesByProject[projectIds.indexOf(projectId)].includes(nodeId)),
        ) && usageByProjectNode[code].some((nodeId) => nodesByProject[projectIds.indexOf(projectId)].includes(nodeId)),
      )
      .map((seed) => seed[1]),
  );

  const insertBatch = db.prepare(
    `INSERT INTO integration_batches
      (code, project_id, title, status, created_by, created_at, sent_at, completed_at, conclusion,
       issue_attribution, test_summary, test_report_url, terminated_at, terminate_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertBatchItem = db.prepare(
    `INSERT INTO batch_items
      (batch_id, package_id, package_version_id, version, archive_url, change_summary, is_changed,
       transfer_request_id, formal_version, trial_versions, previous_test_version, changed_vs_previous)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const lastTestVersion = new Map<string, string>();
  const activeTrials = allActiveTrials([otaTrial, netsyncFormal, keystoreTrial, mediaInTest, diagInTest]);
  function allActiveTrials(versions: VersionSeed[]) {
    return versions.filter((version) => version.status === "TRIAL" || version.status === "PENDING_FORMAL");
  }
  function trialVersionsFor(packageCode: string) {
    return activeTrials
      .filter((version) => version.packageId === codeToId.get(packageCode))
      .map((version) => version.version)
      .join(", ");
  }
  const addBatch = (
    code: string,
    projectIndex: number,
    title: string,
    status: "COMPLETED" | "IN_TEST",
    createdAt: string,
    sentAt: string,
    completedAt: string | null,
    conclusion: "PASS" | "FAIL" | null,
    issueAttribution: "NONE" | "PACKAGE_RELATED" | "NOT_PACKAGE_RELATED" | null,
    summary: string | null,
    report: string | null,
    changedCode: string,
    changedVersion: VersionSeed,
  ) => {
    const projectId = projectIds[projectIndex];
    const batchCreator = projectIndex === 0 ? manager : projectIndex === 1 ? manager2 : projectIndex === 2 ? manager3 : manager;
    const result = insertBatch.run(
      code,
      projectId,
      title,
      status,
      batchCreator,
      iso(createdAt),
      iso(sentAt),
      completedAt ? iso(completedAt) : null,
      conclusion,
      issueAttribution,
      summary,
      report,
      null,
      null,
    );
    const batchId = Number(result.lastInsertRowid);
    for (const packageCode of packagesByProject[projectIndex]) {
      const packageId = codeToId.get(packageCode);
      if (!packageId) continue;
      const formal = formalVersions.get(packageCode);
      if (!formal) continue;
      const changed = packageCode === changedCode;
      const selected = changed ? changedVersion : formal;
      const request = changed ? requests.get(`${selected.id}:${projectId}`) : undefined;
      const previous = lastTestVersion.get(`${projectId}:${packageId}`) ?? null;
      insertBatchItem.run(
        batchId,
        packageId,
        selected.id,
        selected.version,
        selected.archiveUrl,
        selected.summary,
        changed ? 1 : 0,
        request?.id ?? null,
        formal.version,
        trialVersionsFor(packageCode),
        previous,
        previous !== selected.version ? 1 : 0,
      );
      lastTestVersion.set(`${projectId}:${packageId}`, selected.version);
    }
    return batchId;
  };

  addBatch("B118", 2, "磐石 T3 生产验证配套", "COMPLETED", "2026-10-31T17:00:00+08:00", "2026-11-03T09:00:00+08:00", "2026-11-06T17:40:00+08:00", "FAIL", "PACKAGE_RELATED", "1008MED 在 4K 高码率片源切换时复现花屏，定位为解码缓冲区复用问题，与 1008MED 4.2.0 变更相关；其余配套包未发现新增问题。", "https://ci.example.com/reports/B118", "MED", mediaInTest);
  addBatch("B119", 0, "星云 N1 配套回归", "COMPLETED", "2026-11-07T14:00:00+08:00", "2026-11-08T09:00:00+08:00", "2026-11-10T18:10:00+08:00", "PASS", "NONE", "全量配套回归通过，1001OTA 断点续传覆盖弱网、强制重启和大包升级场景，验证结论通过。", "https://ci.example.com/reports/B119", "OTA", otaTrial);
  addBatch("B122", 1, "极光 M2 OTA 专项配套", "COMPLETED", "2026-11-10T10:00:00+08:00", "2026-11-10T15:00:00+08:00", "2026-11-11T15:00:00+08:00", "PASS", "NONE", "1001OTA 1.6.0 在 M2 项目升级场景全部通过。", "https://ci.example.com/reports/B122", "OTA", otaTrial);
  addBatch("B120", 0, "星云 N1 DVT 配套验证", "IN_TEST", "2026-11-12T16:00:00+08:00", "2026-11-13T09:00:00+08:00", null, null, null, null, null, "DIA", diagInTest);
  addBatch("B121", 1, "极光 M2 媒体专项验证", "IN_TEST", "2026-11-13T14:00:00+08:00", "2026-11-13T16:00:00+08:00", null, null, null, null, null, "MED", mediaInTest);

  const nodeApprover = (nodeId: number) => {
    const projectIndex = nodesByProject.findIndex((nodes) => nodes.includes(nodeId));
    return projectApprovers[projectIndex];
  };
  const insertRequirement = db.prepare(
    `INSERT INTO binding_requirements
      (request_id, package_version_id, project_id, node_id, required_count, binding_owner_id, approver_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertFlow = db.prepare(
    `INSERT INTO binding_flows
      (flow_no, requirement_id, package_version_id, project_id, node_id, device_barcode, web_url,
       submitted_by, approver_id, status, submitted_at, reviewed_at, review_comment, cancelled_at, cancel_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
  );
  const insertFlowBarcode = db.prepare(
    "INSERT INTO binding_flow_barcodes (flow_id, barcode, created_at) VALUES (?, ?, ?)",
  );
  let flowSequence = 0;
  const addFlow = (
    requirementId: number,
    version: VersionSeed,
    projectId: number,
    nodeId: number,
    barcodes: string[],
    status: "PENDING" | "APPROVED" | "REJECTED",
    submittedAt: string,
    reviewedAt: string | null,
    comment: string | null,
  ) => {
    flowSequence += 1;
    const approver = nodeApprover(nodeId);
    const result = insertFlow.run(
      `BF-2026-${String(flowSequence).padStart(4, "0")}`,
      requirementId,
      version.id,
      projectId,
      nodeId,
      barcodes.join(", "),
      `https://eflow.example.com/binding/BF-2026-${String(flowSequence).padStart(4, "0")}`,
      hanSong,
      approver,
      status,
      iso(submittedAt),
      reviewedAt ? iso(reviewedAt) : null,
      comment,
    );
    const flowId = Number(result.lastInsertRowid);
    for (const barcode of barcodes) {
      insertFlowBarcode.run(flowId, barcode, iso(submittedAt));
    }
    return flowId;
  };
  const createRequirements = (
    version: VersionSeed,
    requestId: number,
    projectIndex: number,
    packageCode: string,
  ) => {
    const result: Array<{ id: number; nodeId: number; nodeName: string }> = [];
    for (const nodeId of usageByProjectNode[packageCode]) {
      if (!nodesByProject[projectIndex].includes(nodeId)) continue;
      const nodeName = nodeNames[nodesByProject[projectIndex].indexOf(nodeId)];
      const insert = insertRequirement.run(
        requestId,
        version.id,
        projectIds[projectIndex],
        nodeId,
        1,
        hanSong,
        nodeApprover(nodeId),
        "PENDING",
        iso("2026-11-11T18:10:00+08:00"),
        iso("2026-11-14T10:00:00+08:00"),
      );
      result.push({ id: Number(insert.lastInsertRowid), nodeId, nodeName });
    }
    return result;
  };

  const netRequest = requests.get(`${netsyncFormal.id}:${projectIds[0]}`);
  if (netRequest) {
    const netRequirements = createRequirements(netsyncFormal, netRequest.id, 0, "NET");
    for (const requirement of netRequirements) {
      addFlow(
        requirement.id,
        netsyncFormal,
        projectIds[0],
        requirement.nodeId,
        [`SN-N1-${requirement.nodeName}-${netsyncFormal.version.replaceAll(".", "")}`],
        "APPROVED",
        "2026-11-12T09:00:00+08:00",
        "2026-11-13T11:00:00+08:00",
        "硬件绑定验证通过，条码与软件包版本匹配。",
      );
      db.prepare("UPDATE binding_requirements SET status = 'PASSED' WHERE id = ?").run(requirement.id);
    }
  }

  const keyRequest = requests.get(`${keystoreTrial.id}:${projectIds[0]}`);
  if (keyRequest) {
    const keyRequirements = createRequirements(keystoreTrial, keyRequest.id, 0, "KEY");
    const evtRequirement = keyRequirements.find((requirement) => requirement.nodeName === "EVT");
    const pvtRequirement = keyRequirements.find((requirement) => requirement.nodeName === "PVT");
    if (evtRequirement) {
      addFlow(
        evtRequirement.id,
        keystoreTrial,
        projectIds[0],
        evtRequirement.nodeId,
        ["HW-N1-0001"],
        "APPROVED",
        "2026-11-12T10:00:00+08:00",
        "2026-11-12T15:00:00+08:00",
        "条码绑定信息核对通过。",
      );
      db.prepare("UPDATE binding_requirements SET status = 'PASSED' WHERE id = ?").run(evtRequirement.id);
    }
    if (pvtRequirement) {
      addFlow(
        pvtRequirement.id,
        keystoreTrial,
        projectIds[0],
        pvtRequirement.nodeId,
        ["HW-N1-0002", "HW-N1-0003"],
        "PENDING",
        "2026-11-14T09:30:00+08:00",
        null,
        null,
      );
      addFlow(
        pvtRequirement.id,
        keystoreTrial,
        projectIds[0],
        pvtRequirement.nodeId,
        ["HW-N1-0009"],
        "REJECTED",
        "2026-11-13T10:00:00+08:00",
        "2026-11-13T16:00:00+08:00",
        "设备条码不在本轮绑定清单内，请核对后重新提交。",
      );
    }
  }

  db.exec(`
    INSERT OR IGNORE INTO binding_requirement_approvers (requirement_id, user_id, created_at)
    SELECT br.id, pna.user_id, '${iso("2026-11-14T10:00:00+08:00")}'
    FROM binding_requirements br
    JOIN project_node_approvers pna ON pna.node_id = br.node_id
  `);

  const insertProgress = db.prepare(
    "INSERT INTO batch_progress_notes (batch_id, author_id, content, created_at) VALUES (?, ?, ?, ?)",
  );
  insertProgress.run(4, tester, "N1 DVT 配套已完成第一轮冒烟，配置下发与回读通过，继续覆盖异常断电场景。", iso("2026-11-13T11:00:00+08:00"));
  insertProgress.run(5, tester2, "M2 媒体专项已开始，4K 解码基础场景通过，等待高码率片源完成。", iso("2026-11-14T10:30:00+08:00"));

  // 历史风险发布示例：NET M2/T3 没有关联集成测试批次，直接按风险结论进入待发布试制。
  db.prepare(
    `UPDATE version_transfer_requests
     SET release_mode = 'RISK', risk_conclusion = '集成测试资源不足，结合历史版本回归结论按风险发布。'
     WHERE id IN (
       SELECT r.id FROM version_transfer_requests r
       JOIN package_versions pv ON pv.id = r.package_version_id
       JOIN packages p ON p.id = pv.package_id
       JOIN projects pr ON pr.id = r.project_id
       WHERE p.code = 'NET' AND pv.version = '2.0.0' AND pr.code IN ('M2','T3')
     )`,
  ).run();
  // 历史风险发布示例：KEY N1 试制版本没有关联集成测试批次。
  db.prepare(
    `UPDATE version_transfer_requests
     SET release_mode = 'RISK', risk_conclusion = '试制前无可用集成测试环境，按风险评审结论直接发布试制。'
     WHERE id IN (
       SELECT r.id FROM version_transfer_requests r
       JOIN package_versions pv ON pv.id = r.package_version_id
       JOIN packages p ON p.id = pv.package_id
       JOIN projects pr ON pr.id = r.project_id
       WHERE p.code = 'KEY' AND pv.version = '1.3.0' AND pr.code = 'N1' AND r.status = 'TRIAL'
     )`,
  ).run();

  const audit = db.prepare(
    "INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  audit.run(manager, "SEND_BATCH", "BATCH", 4, "发起 B120 星云 N1 配套转测", iso("2026-11-13T09:00:00+08:00"));
  audit.run(manager, "RELEASE_TRIAL", "PACKAGE_VERSION", keystoreTrial.id, "提交 1006KEY 1.3.0 发布试制电子流并发布试制", iso("2026-11-11T18:00:00+08:00"));
  audit.run(manager, "RELEASE_TRIAL", "PACKAGE_VERSION", netsyncFormal.id, "提交 1004NET 2.0.0 发布试制电子流并发布试制", iso("2026-11-09T17:00:00+08:00"));
  audit.run(hanSong, "SUBMIT_BINDING_FLOW", "BINDING_FLOW", 1, "提交 1006KEY 1.3.0 的硬件绑定电子流", iso("2026-11-12T10:00:00+08:00"));
  audit.run(wangLei, "APPROVE_BINDING_FLOW", "BINDING_FLOW", 1, "审批通过 1006KEY 1.3.0 的硬件绑定电子流", iso("2026-11-12T15:00:00+08:00"));
  audit.run(tester, "COMPLETE_BATCH", "BATCH", 1, "提交 B118 集成测试结论：测试不通过", iso("2026-11-06T17:40:00+08:00"));
  audit.run(admin, "CREATE_AREA", "AREA", areaIds[0], "创建责任田：系统底座", iso("2026-09-01T09:10:00+08:00"));
  audit.run(xuYan, "ARCHIVE_PROJECT", "PROJECT", projectIds[3], "远山 X0 项目结束并归档", iso("2026-10-30T17:00:00+08:00"));
}
