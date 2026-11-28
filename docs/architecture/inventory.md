# 实现与约束清单

[架构与状态地图](README.md)列出模块和数据的所有者。[流程授权](authorization.md)记录读取和办理范围。[治理进度](progress.md)与[架构决策](decisions.md)记录验证和取舍，[优化任务池](backlog.md)跟踪待办。运行 `node scripts/check-architecture.mjs --graph` 从当前检出生成完整的源码依赖图。

## 技术方案

| 范围 | 当前方案与契约 | 验证入口 |
| --- | --- | --- |
| 界面与状态 | Next.js App Router 负责路由和首屏。React 客户端组件持有表单、筛选控件和选中状态。列表条件用 URL 恢复。Tailwind 与全局样式提供设计规范，原生 `dialog` 管理焦点。 | [界面规范](../../AGENTS.md#界面层级与文案)、[弹窗钩子](../../components/use-modal-dialog.ts)、[窄屏回归](../../tests/e2e/workspace-width.spec.ts) |
| 业务办理 | Server Action 处理会话、表单反馈和跳转。工作流服务负责权限、阶段、并行变更和事务写入。配置修改引起的范围联动复用转测申请服务。 | [发布写入](../../lib/release-workflow.ts)、[批次写入](../../lib/batch-workflow.ts)、[转测申请](../../lib/transfer-requests.ts)、[流程回归](../../tests/e2e/workflow.spec.ts) |
| 软件包详情接口 | `GET /api/packages/[id]` 对未登录请求返回 401，包编号无法解析为整数时返回 400。包或项目不可读、项目参数重复或记录缺失时返回 404。成功 JSON 使用 `no-store`，和页面预加载共享授权投影。 | [接口](../../app/api/packages/[id]/route.ts)、[接口与抽屉回归](../../tests/e2e/package-experience.spec.ts) |
| 验证报告接口 | `GET /api/reports/[id]` 对未登录请求返回 401。报告权限沿用对应证据读取规则。无效编号、缺失、不可读或无法下载返回 404。成功响应按受支持的原文件名后缀确定媒体类型，保留历史纯文本的标准字符集写法、原文件名、原文件内容及 `private, no-store`。未知历史后缀以附件下载。 | [接口](../../app/api/reports/[id]/route.ts)、[报告回归](../../tests/e2e/workflow.spec.ts) |
| 通知入口 | `GET /api/notifications/read` 使用 303 导航。未登录跳到登录。登录后按当前账号记录已读，再跳到校验后的站内路径，默认回工作台。 | [接口](../../app/api/notifications/read/route.ts)、[工作台回归](../../tests/e2e/dashboard.spec.ts) |
| 会话、授权与缓存 | Cookie 承载会话令牌，SQLite 保存会话与账号状态。React `cache` 在同一次服务端渲染中复用会话查询。项目、责任田和单据分别校验权限。配置和流程操作成功后通过 Action 助手刷新工作区布局。 | [认证](../../lib/auth.ts)、[Action 助手](../../lib/action-helpers.ts)、[指派授权回归](../../tests/e2e/assignment-authorization.spec.ts) |
| 数据访问与运行配置 | Node 内置 SQLite 启用外键、WAL 和 5 秒锁等待。启动迁移和跨表变更使用事务，失败回滚。业务事务没有自动重放。数据库、报告目录和演示数据开关共用运行配置。 | [连接与迁移](../../lib/db.ts)、[配置解析](../../lib/runtime-config.ts)、[运行与部署](../../README.md) |
| 错误、恢复与记录 | 领域错误转为可操作的表单反馈，未分类故障记录服务端日志。报告存储对文件和元数据分步失败执行补偿。业务审计通过当前写入连接保存，随事务提交或回滚。 | [领域错误](../../lib/domain-error.ts)、[报告存储](../../lib/report-storage.ts)、[业务审计](../../lib/audit-log.ts) |
| 构建与防回归 | 依赖按 pnpm 锁文件冻结。ESLint 和 TypeScript 依赖检查器校验应用入口、模块循环和路由范围。Playwright 使用隔离数据库和报告路径，GitHub Actions 在 Ubuntu 执行检查。Shell 测试用模拟命令验证部署顺序。 | [架构检查](../../scripts/check-architecture.mjs)、[Playwright 配置](../../playwright.config.ts)、[CI](../../.github/workflows/verify.yml) |

## 已统一的重复实现

| 原并行路径 | 当前权威入口 | 差异或证据 |
| --- | --- | --- |
| 早期服务与现行工作流 | [发布写入](../../lib/release-workflow.ts)、[批次写入](../../lib/batch-workflow.ts) | 退役无现行调用的 `lib/services.ts`。历史记录仍可读取。 |
| 列表预加载与 HTTP 抽屉详情 | [抽屉投影](../../lib/package-queries.ts) | 复用同一授权和投影，保留项目过滤及 HTTP 错误响应。 |
| 各列表的分页范围与应用入口参数 | [分页窗口](../../lib/list-pagination.ts) | 数组与 SQLite 使用同一窗口计算，各入口保留自己的 URL 参数。 |
| 不同页面维护的批次证据和试制门槛 | [证据授权](../../lib/access.ts)、[试制资格](../../lib/trial-eligibility.ts)、[转正检查](../../lib/trial-readiness.ts) | 流程条件由服务端复核，证据由实际所属项目授权。资格与证据展示各自保留对应的检查。 |
| 批次详情、表单和事务各自计算测试结论影响与归属 | [集成测试结论规则](../../lib/integration-conclusion.ts) | 批次视图和事务共用并行风险试制识别。表单、Action 与服务共用结论枚举、归属配对和影响选择规则。 |
| 逐包与列表查询上次转测版本 | [转测申请](../../lib/transfer-requests.ts) | 一个按项目和软件包范围执行的查询，草稿写入事务重新读取。 |
| 待转测列表与草稿事务各自识别待安排状态和占用 | [转测申请](../../lib/transfer-requests.ts) | 待安排来自有效集成状态。草稿事务共用未结束批次关联，按检查阶段确定当前草稿是否排除。 |
| 全量项目设置与软件包节点选择 | [项目选项与节点](../../lib/project-queries.ts) | 选择器复用项目列表与节点基础字段，按范围批量查询。审批人配置由节点详情读取。 |
| 配置目录和节点详情复用全量项目配置 | [项目设置查询](../../lib/project-queries.ts) | 目录读取可管理项目的摘要，项目详情读取单项目的节点及审批人数，节点详情读取目标节点和审批人名单。 |
| 从责任田完整配置提取软件包选项 | [责任田选项](../../lib/organization-queries.ts) | 选项共用基础查询，按各入口的原排序显示。完整配置按单个责任田读取。 |
| 节点状态、条码统计与确认逻辑 | [节点办理状态](../../lib/binding-availability.ts)、[条码判定](../../lib/binding-barcode-results.ts) | 页面和事务使用同一统计与条件，失败原因沿用已有证据。 |
| 按节点逐次读取电子流、条码与审批人 | [绑定详情投影](../../lib/binding-queries.ts) | 每份申请批量读取并分组，按账号过滤后计算可见统计。 |
| 为绑定队列逐条读取完整详情 | [绑定队列计数和详情授权](../../lib/binding-queries.ts) | 缩小读取字段和范围，详情与队列共用可见性规则。指定审批人前后计数由端到端回归核对。 |
| 从全工作区的待转测和待转正数据中提取项目范围 | [待转测查询](../../lib/pending-transfer-queries.ts)、[待转正查询](../../lib/release-queue-queries.ts) | 先在 SQLite 筛选申请所属项目，再投影证据。草稿处理范围与申请可见范围分别保留。 |
| 项目流程卡片为取得数量读取绑定与转正完整列表 | [流程计数与列表规则](../../lib/release-queue-queries.ts) | 单次聚合查询复用列表状态与超期规则，保留按项目申请计数。 |
| 项目卡片为取得待安排与待发试制数量读取完整队列 | [待安排行数](../../lib/pending-transfer-queries.ts)、[试制资格](../../lib/trial-eligibility.ts) | 计数复用原队列条件和共享试制资格。候选版本筛选与全项目验收各按原有范围执行。 |
| 项目软件包预览先加载全部软件包和流程字段再截取五项 | [软件包预览与完整读取](../../lib/package-queries.ts) | 查询按项目用途返回前五项及总数。用途与版本展示规则仍由同一模块维护。 |
| 工作台用完整批次列表生成待办并重复读取重叠项目 | [工作台批次查询](../../lib/batch-queries.ts)、[兼任角色回归](../../tests/e2e/dashboard.spec.ts) | 查询只读取待办使用的列，跟踪和办理各自归类。混合分工场景验证排序和跳转。 |
| 软件包配置为加载编辑字段读取完整抽屉详情 | [软件包配置与详情查询](../../lib/package-queries.ts) | 配置表单读取摘要和当前用途。抽屉和 HTTP 详情沿用完整投影与各自权限。 |
| 设置页面和抽屉依赖配置写入模块来查询证据 | [配置查询](../../lib/settings-queries.ts)、[软件包写入](../../lib/package-settings.ts)、[项目写入](../../lib/project-settings.ts)、[架构检查](../../scripts/check-architecture.mjs) | 查询有独立来源，页面和事务共用，检查拦截已迁移入口直接引用写入模块。 |
| 总览在校验可见软件包前读取全部摘要、使用范围与申请 | [软件包总览](../../lib/package-queries.ts)、[版本和软件包读取范围](../../lib/access.ts) | 现有授权作为摘要读取边界，版本显示继续执行原有字段脱敏。 |
| 角色变更与停用在事务外各自检查最后一名启用管理员 | [账号写入](../../lib/user-settings.ts)、[管理员保留回归](../../tests/e2e/settings-admin-floor.spec.ts) | 事务内共用账号保留规则，读到的目标状态和计数与最终写入一致。 |
| 工作台为显示最近四项读取每项目的全部待安排申请 | [待转测预览](../../lib/pending-transfer-queries.ts)、[工作台查询](../../lib/workbench-queries.ts)、[工作台回归](../../tests/e2e/dashboard.spec.ts) | 共用业务资格和排序条件，由 SQLite 按项目返回计数及有限预览。 |
| 工作台为当前通知读取账号全部历史已读键 | [通知已读](../../lib/notification-reads.ts)、[工作台回归](../../tests/e2e/dashboard.spec.ts) | 依靠现有复合唯一键查询当前候选，并由已读模块维护历史键兼容。 |
| 待发试制预览读取整份队列详情 | [共享试制资格](../../lib/trial-eligibility.ts)、[共享版本回归](../../tests/e2e/trial-eligibility.spec.ts) | 两种投影共用资格和顺序，待办读取已使用的字段。 |
| 绑定详情、队列统计与全链路聚合共处于工作流查询 | [绑定证据读取](../../lib/binding-queries.ts)、[绑定回归](../../tests/e2e/binding-controls.spec.ts) | 绑定查询负责展示与证据投影，事务继续使用领域模块规则。 |
| 密码修改与账号停用各自撤销会话，认证多次查询相同的有效期条件 | [会话存储](../../lib/session-store.ts)、[认证服务](../../lib/auth.ts)、[账号密码回归](../../tests/e2e/account-password.spec.ts) | 会话数据、过期边界及撤销规则集中，当前用户读取只投影会话需要的账号字段。 |
| 批次页面和报告接口由聚合工作流查询提供全部读取 | [批次查询](../../lib/batch-queries.ts)、[报告入口](../../app/api/reports/[id]/route.ts) | 读模型独立拥有批次资料，事务继续使用转测预留与集成验收规则。 |
| 待转测清单、计数和预览留在聚合查询中并被转正复用项目范围 | [待转测读模型](../../lib/pending-transfer-queries.ts)、[转测申请规则](../../lib/transfer-requests.ts) | 项目范围归入申请规则，其余投影由待转测模块维护。 |
| 实例迁移、应用事务和补派各自执行写事务，命令回滚失败会覆盖写入错误 | [即时写事务](../../lib/sqlite-lifecycle.ts)、[补派命令](../../scripts/backfill-trial-transfer-requests.ts)、[生命周期回归](../../tests/e2e/sqlite-lifecycle.spec.ts) | 同一实现处理提交和错误传播，调用方拥有连接、事务边界与输出。 |
| 试制、待转正计数与历史访问留在聚合工作流查询 | [发布队列查询](../../lib/release-queue-queries.ts)、[转正详情](../../app/(workspace)/formal/[id]/page.tsx) | 读取按已有范围投影，队列与历史的不同条件由发布查询模块维护。 |
| 绑定命令、转测和转正发布共处一个写入模块，推送和跳过重复读取目标 | [绑定写入](../../lib/binding-workflow.ts)、[绑定操作入口](../../lib/actions/binding.ts)、[授权](../../lib/access.ts) | 命令直接由绑定模块执行，共用记录定位与版本管理规则。 |
| 版本提交、项目申请分发与撤回留在跨阶段写入 | [转测写入](../../lib/transfer-workflow.ts)、[转测申请规则](../../lib/transfer-requests.ts) | 提交与撤回由转测写入模块负责，使用范围、授权以及历史引用检查沿用原有规则。 |
| 批次办理与发布作废在跨阶段写入模块中共享私有事务逻辑 | [批次写入](../../lib/batch-workflow.ts)、[版本作废记录](../../lib/version-void-workflow.ts)、[流程回归](../../tests/e2e/workflow.spec.ts) | 批次命令拥有报告及事务，作废记录由实际命令在既有事务内写入。 |
| 三个视图各自计算试制释放时间与超期天数 | [截止时间定义](../../lib/trial-readiness.ts)、[归档回归](../../tests/e2e/trial-queue.spec.ts) | 共用 SQLite 时间条件，保留每处使用结果的业务范围。 |
| 转测表单将可提交条件与服务端四项字段校验分别实现 | [字段校验](../../lib/transfer-form-validation.ts)、[转测表单](../../components/transfer-request-form.tsx) | 共用字段条件及顺序，界面提示与服务端业务错误分别由调用方呈现。 |
| 帮助提示与表头筛选重复读取视口、约束横向位置和订阅事件 | [弹层视口](../../components/popover-viewport.ts)、[提示](../../components/info-tooltip.tsx)、[表头筛选](../../components/column-filter-popover.tsx) | 通用定位与事件订阅集中，弹层交互由各组件负责。 |
| 原跨阶段工作流写入文件只剩发布命令 | [发布写入](../../lib/release-workflow.ts)、[风险登记入口](../../lib/actions/risk-trial.ts) | 现行 Action 直接调用发布模块，写入依赖约束同步迁移。 |
| 软件包配置与历史补录写入和组织账号配置共处一处 | [软件包配置写入](../../lib/package-settings.ts)、[软件包设置操作入口](../../lib/actions/package-settings.ts) | 软件包使用范围和补录事务由同一写入模块负责，配置及抽屉查询沿用既有读取入口。 |
| 项目节点配置与组织及账号命令共用写入文件 | [项目和节点写入](../../lib/project-settings.ts)、[配置证据读取](../../lib/settings-queries.ts) | 项目恢复、节点池和审批人保护由明确的配置写入入口负责。 |
| 通用设置写入只剩责任田分工和账号状态 | [责任田分工写入](../../lib/area-settings.ts)、[账号写入](../../lib/user-settings.ts) | 真实调用迁移到各写入模块，继续使用现有查询、审计和会话边界。 |
| 同一查询文件管理软件包详情、组织分工和反馈参数 | [软件包查询](../../lib/package-queries.ts)、[组织查询](../../lib/organization-queries.ts)、[反馈参数](../../lib/flash.ts) | 页面和组件直接使用各自入口，受保护的抽屉投影仍由统一适配模块提供。 |
| 试制资格、补派和结论处理各自列举相同状态 | [转测申请状态条件](../../lib/transfer-requests.ts) | 两组状态由转测领域维护，试制资格和批次写入引用各自适用的条件。 |
| 写入入口守卫只覆盖部分页面及组件 | [架构检查](../../scripts/check-architecture.mjs) | 按现有运行时调用关系校验流程和设置写入入口，保留允许的领域命令和类型依赖。 |
| 软件包两个停用入口使用不同时间点读取启用状态 | [软件包配置写入](../../lib/package-settings.ts)、[并发回归](../../tests/e2e/settings-write-transactions.spec.ts) | 事务内读同一份状态和版本证据，保留现有入口权限及对历史启用标记的解释。 |
| 两种软件包保存入口都在事务前读取拟指派账号状态 | [软件包配置写入](../../lib/package-settings.ts)、[账号停用](../../lib/user-settings.ts) | 两个写入路径的在用责任人条件由同一事务边界复核，停用账号仍保留未启用软件包的历史指派。 |
| 新建版本表和转测申请表后仍需补建三个通用字段 | [字段声明](../../lib/schema.ts)、[旧库迁移](../../lib/db.ts) | 新库建表时具备完整字段，旧库按相同声明补列。历史数据迁移与外键保持现有行为。 |
| 软件包指派与责任田删除之间的引用检查时点不同 | [责任田写入](../../lib/area-settings.ts)、[软件包写入](../../lib/package-settings.ts)、[两连接回归](../../tests/e2e/settings-write-transactions.spec.ts) | 软件包指派和责任田删除均在写锁内复核，保留已有引用和审计规则。 |
| 写入风险试制登记分散在批次、发布和作废命令中 | [登记写入](../../lib/trial-risk-admissions.ts)、[依赖约束](../../scripts/check-architecture.mjs) | 共用按版本失效，保留终止批次和失败结论各自的范围。现有命令继续负责权限、事务与审计。 |
| 为判断转测入口是否可用而读取完整软件包选项 | [软件包读取](../../lib/package-queries.ts)、[转测引导](../../lib/transfer-guidance.ts) | 查询至多返回一行，资格与表单候选共用。 |
| 补录历史版本读取完整版本和使用范围 | [补录选项](../../lib/package-queries.ts)、[历史补录入口](../../app/(workspace)/settings/packages/import/page.tsx) | 查询先按当前责任田筛选并只返回表单所需字段，保留历史停用包。 |
| 项目导航与目录面包屑各自读取项目选项，总览为判断成员范围重复读取选项 | [项目导航范围](../../lib/project-scope.ts)、[总览入口](../../app/(workspace)/overview/page.tsx) | 以现有授权清单限制侧栏和总览的工作区入口。目录面包屑仍可显示相应项目资料。 |
| 软件包写入在事务外读取当前归属、旧编码及补录版本占用 | [软件包写入](../../lib/package-settings.ts)、[两连接回归](../../tests/e2e/settings-write-transactions.spec.ts) | 在写锁内读取同一份当前记录。配置和抽屉保留各自的权限，补录保留大小写不敏感的版本号规则。 |
| 节点指派、项目及节点删除基于事务外的对象和授权 | [项目节点写入](../../lib/project-settings.ts)、[设置写事务回归](../../tests/e2e/settings-write-transactions.spec.ts) | 权限和依赖在写入事务内复核，沿用同名节点、指派、删除保护和审计规则。 |
| 责任田管理和人员指派在事务外读取对象、授权及重名 | [责任田写入](../../lib/area-settings.ts)、[设置写事务回归](../../tests/e2e/settings-write-transactions.spec.ts) | 在写锁内核对当前资料，继续依照各级分工及负责人原有的防覆盖规则。 |
| 软件包抽屉先读取全部版本和审计再裁掉不可见行 | [软件包抽屉](../../lib/package-queries.ts)、[软件包权限](../../lib/access.ts) | 版本细节按已有授权结果读取。保留摘要标签裁剪、批次证据限制和接口字段。 |
| 集成测试进展和结论的分工校验与写入处于不同时间点 | [集成测试写入](../../lib/batch-workflow.ts)、[流程回归](../../tests/e2e/workflow.spec.ts) | 进展在事务内核对分工，结论读取上传内容后再核对当前状态与分工。 |
| 工作台使用完整的转正队列查询生成待办 | [转正读取](../../lib/release-queue-queries.ts)、[工作台回归](../../tests/e2e/dashboard.spec.ts) | 工作台读取六列；资格、排序及项目范围与完整转正队列共用。 |
| 主侧栏和窄屏配置标签各自判断分工、维护配置目录 | [设置导航](../../lib/settings-navigation.ts)、[配置范围回归](../../tests/e2e/assignment-authorization.spec.ts) | 服务端复用一份菜单与请求内分工结果，保留窄屏短标签及实际操作的独立权限校验。 |
| 补录命令和历史读取分别声明补录审计动作与实体 | [存储证据](../../lib/version-scope.ts)、[补录写入](../../lib/package-settings.ts) | 读写共用同一对存储值，原始标记和其他历史版本兼容方式继续有效。 |
| 21 个页面分别决定跳转提示的色调和参数解析 | [跳转提示](../../lib/flash.ts)、[登录与跳转回归](../../tests/e2e/public-auth.spec.ts) | 路由统一读取参数对象，保留重复参数、空值和默认色调规则。 |
| 责任田多个关闭的人员对话框重复序列化选项 | [责任田详情](../../app/%28workspace%29/settings/areas/%5Bid%5D/page.tsx)、[人员选择](../../components/settings-person-picker.tsx)、[窄屏回归](../../tests/e2e/settings-experience.spec.ts) | 同页共用一份可选账号并传递每处排除名单，只序列化至少在一处有资格的账号。 |
| 注册、登录与管理员脚本重复写工号规范化或格式规则 | [账号标识](../../lib/account-identity.ts)、[账号回归](../../tests/e2e/public-auth.spec.ts) | 共用纯规则，保持各入口采用规范化、原样校验及账号查找的顺序。管理员创建复用部门配置。 |
| 人员选择接口附带未使用的职位、角色和包含停用账号参数 | [组织查询](../../lib/organization-queries.ts)、[选择回归](../../tests/e2e/settings-experience.spec.ts) | 选人共用启用账号字段，人员管理与指派详情保留各自完整投影。 |
| 软件包设置目录先读取全站摘要和试制状态再裁减责任田范围 | [软件包读取](../../lib/package-queries.ts)、[设置目录回归](../../tests/e2e/package-settings-directory.spec.ts) | 将责任田范围下推，复用当前版本和试制进展规则，删除无调用的完整管理列表。 |
| 绑定电子流按节点要求读取时多处扫描单据 | [索引定义](../../lib/schema.ts)、[待办及审批](../../lib/workbench-queries.ts)、[启动回归](../../tests/e2e/binding-approver-snapshot.spec.ts) | 支持单节点查找。保留审批时间排序及原有的电子流优先联接。 |
| 项目节点配置与添加审批人分别序列化人员选项 | [节点表单](../../components/settings-node-fields.tsx)、[人员选择](../../components/settings-person-picker.tsx) | 共用当前页面原先可见的选项，保留已有审批人排除、服务端表单提交和空状态。 |
| 部署直到停服后才检验 Node 与 pnpm 能否运行 | [部署脚本](../../scripts/deploy-ubuntu.sh)、[部署模拟](../../tests/deploy-ubuntu.sh) | 先检查运行能力，沿用现有服务、外部命令及构建分支。 |
| 补派预览直接依赖运行时支持只读连接 | [补派命令](../../scripts/backfill-trial-transfer-requests.ts)、[SQLite 回归](../../tests/e2e/sqlite-lifecycle.spec.ts) | 用内存连接检验只读选项实际生效。继续使用原有补派事务和路径校验。 |
| 管理员命令在事务外决定创建或提升同一工号 | [管理员命令](../../scripts/create-admin.ts)、[写入回归](../../tests/e2e/settings-write-transactions.spec.ts) | 在同一写锁内查找并更新，用原有工号匹配、密码和部门规则。提交后输出成功。 |
| 软件包抽屉为单包加载全站可见版本和包 ID | [授权域](../../lib/access.ts)、[抽屉读取](../../lib/package-queries.ts)、[接口回归](../../tests/e2e/package-experience.spec.ts) | 同一授权关系支持按包查询。存在可读版本时直接确认软件包可读，保留没有可读版本时的资料权限。 |
| 待发试制项目清单先计算全站版本资格 | [试制资格](../../lib/trial-eligibility.ts)、[队列回归](../../tests/e2e/trial-queue.spec.ts) | 清单与工作台共用候选版本范围。普通试制与风险试制仍按全部适用项目判断，版本或申请定位保留原有查询。 |
| 报告写入和仅有旧链接的批次授权各自生成同一持久化地址 | [报告地址](../../lib/workflow-links.ts)、[历史下载回归](../../tests/e2e/report-download.spec.ts) | 将两处迁移到同一地址格式，保留批次和上传人的独立授权及历史链接。 |
| 版本追溯详情和标签读取全站可见版本 ID | [版本授权](../../lib/access.ts)、[追溯查询](../../lib/version-trace-queries.ts)、[标签页回归](../../tests/e2e/version-trace-list.spec.ts) | 当前版本和标签先按现有规则规范化，按最多八个版本校验原有权限。详情继续按项目和批次权限展示证据。 |
| 软件包项目筛选从全站可读包判断单项目 | [项目范围](../../lib/project-scope.ts)、[授权条件](../../lib/access.ts)、[项目回归](../../tests/e2e/project-scope.spec.ts) | 仅扫描项目使用的候选包。保留任一项目产生的既有版本权限、无版本的包权限，以及独立的项目工作区权限。 |
| 项目经理索引在旧库补齐依赖列前创建 | [数据库启动](../../lib/db.ts)、[旧库回归](../../tests/e2e/sqlite-lifecycle.spec.ts) | 在补齐列后创建原索引，当前库和新建库沿用相同定义。 |
| 已结束转正页面加载不会展示的绑定详情 | [转正引导](../../lib/release-guidance.ts)、[绑定范围查询](../../lib/binding-queries.ts)、[历史引导回归](../../tests/e2e/release-guidance.spec.ts) | 已结束入口根据已有可读范围选择追溯链接；仍开放的办理入口继续读取实际绑定证据。 |
| 风险试制登记重复计算同一版本的资格证据 | [资格查询](../../lib/trial-eligibility.ts)、[登记事务](../../lib/release-workflow.ts)、[浏览器回归](../../tests/e2e/risk-trial-entry.spec.ts) | 同一查询核对指定申请并取得版本统计。列表沿用现有批量读取，阶段判断由同一表达式提供。 |
| 一次批量就绪刷新反复编译同一批 SQLite 语句 | [就绪刷新](../../lib/trial-readiness.ts)、[绑定回归](../../tests/e2e/binding-controls.spec.ts) | 单次刷新惰性复用语句。各版本持续读取原连接上的当前证据，事务和写入次序保持原样。 |
| 按版本查找批次项时多处扫描同一快照表 | [批次版本索引](../../lib/schema.ts)、[版本追溯](../../lib/version-trace-queries.ts)、[启动回归](../../tests/e2e/sqlite-lifecycle.spec.ts) | 通过同一个索引支持按版本的关联。对同一时间的批次顺序敏感的追溯明细保留原有谓词计划。 |
| 单软件包流程权限曾加载全部可读包与版本 | [包授权](../../lib/access.ts)、[转测引导](../../lib/transfer-guidance.ts)、[发布引导](../../lib/release-guidance.ts) | 单包判断和项目包存在性使用同一授权谓词和查询。抽屉仍读取展示所需的版本范围。 |
| 代理入口未应用会话存储的调用方约束 | [架构检查](../../scripts/check-architecture.mjs)、[检查器契约](../../tests/architecture-check.test.mjs) | 复用应用模块分类，发现代理入口直接读取会话存储时报告架构违规。合法调用方保持原范围。 |
| 历史版本导入和更正各自读取并声明相同元数据 | [写入口](../../lib/actions/package-settings.ts)、[包设置](../../lib/package-settings.ts)、[历史发布字段](../../components/legacy-release-fields.tsx) | 两个操作共用私有元数据解码器。记录标识、状态和更正理由仍由对应的操作处理。 |
| 工作流提交共用一个可导入所有写模块的入口 | [转测](../../lib/actions/transfer.ts)、[批次](../../lib/actions/batch.ts)、[绑定](../../lib/actions/binding.ts)、[发布](../../lib/actions/release.ts)、[架构契约](../../tests/architecture-check.test.mjs) | 各页面调用对应写入口，风险登记保留专用入口，跨流程回跳参数持续共用。检查器拒绝绕过写入所有者。 |
| 转正核对沿用列表查询及未展示的节点统计 | [发布队列](../../lib/release-queue-queries.ts)、[转正核对](../../app/(workspace)/formal/[id]/page.tsx) | 在同一查询模块复用范围与排序，按页面读取最少字段。完整项目节点统计仍用于相关队列。 |
| 账号操作与提示重复声明新密码长度 | [密码规则](../../lib/password-policy.ts)、[认证表单动作](../../app/(auth)/actions.ts)、[管理员命令](../../scripts/create-admin.ts) | 网页和维护命令共用最短长度。网页输入及提示使用自己的上限，登录和历史密码沿用已有校验方式。 |
| 多个客户端列表内重复绘制页码和翻页按钮 | [本地分页](../../components/local-pagination.tsx)、[分页计算](../../lib/list-pagination.ts)、[工作区导航](../../components/workspace-navigation.tsx) | 各页面继续负责筛选、状态和回调。导航按钮、页码和边界禁用共用一个实现。 |
| 批次准备向页面发送未使用的归档地址与版本说明 | [批次读取](../../lib/batch-queries.ts)、[配套页面](../../components/batch-builder.tsx)、[批次写入](../../lib/batch-workflow.ts) | 准备查询保留版本选项、待转测关联和历史配套。写事务继续从当前版本记录获取落库快照。 |
| 设置表单共用一个可导入所有设置写模块的入口 | [责任田](../../lib/actions/area-settings.ts)、[项目](../../lib/actions/project-settings.ts)、[软件包](../../lib/actions/package-settings.ts)、[账号](../../lib/actions/user-settings.ts)、[架构契约](../../tests/architecture-check.test.mjs) | 表单直接使用对应 Action。守卫验证合法导入并拒绝四类跨职责写入。 |
| 多个数据库 CHECK、类型守卫与页面选项重复枚举合法值 | [领域值](../../lib/domain-values.ts)、[SQLite 结构](../../lib/schema.ts)、[展示元数据](../../lib/constants.ts)、[项目设置字段](../../components/project-settings-fields.tsx) | 存储接受值和类型由纯领域模块提供，类型检查保证展示映射覆盖。各流程继续独立维护有不同含义的状态子集和转换条件。 |
| 批次编辑读取测试进展和完整配套证据 | [批次读取](../../lib/batch-queries.ts)、[草稿编辑](../../app/(workspace)/submissions/batch/new/page.tsx) | 编辑使用专门投影。保持证据权限、配套顺序、旧库修订值与原详情跳转。 |
| 为定位单个项目加载完整项目和分工列表 | [项目授权](../../lib/access.ts)、[项目资料](../../lib/project-queries.ts) | 单项目读取定向查询。导航仍读取完整授权范围，单据和软件包访问保留各自的例外。 |
| 转正核对、绑定详情及追溯同时重复加载对应绑定申请 | [页面绑定详情读取](../../lib/binding-queries.ts) | 同一次渲染按申请复用，授权投影和跨项目证据口径各自执行。 |
| 版本追溯页面和写入事务分别判断作废权限 | [版本维护授权](../../lib/access.ts)、[作废资格](../../lib/version-void.ts) | 页面和事务共用可办理项目及目标分类。依赖检查拦截工作区页面直接引用写入模块。 |
| 多个绑定入口分别组合指定审批人与自审判断 | [审批人判定](../../lib/permissions.ts)、[绑定回归](../../tests/e2e/binding-controls.spec.ts) | 详情、转正引导与事务共用人员判定。工作台在数据库过滤待办，由端到端测试核对与审批入口一致。 |
| 启动迁移和试制发布同时写审批人快照 | [试制发布](../../lib/release-workflow.ts)、[启动迁移](../../lib/db.ts) | 发布事务持有快照写入权，旧记录使用已持久化的主审批人。冷启动回归覆盖保存快照和兼容回退。 |
| 每次启动对既有节点主审批人配置重复尝试插入 | [节点配置迁移](../../lib/db.ts)、[冷启动回归](../../tests/e2e/binding-approver-snapshot.spec.ts) | 查询排除存在的配置，保留旧库补齐，冷启动回归核对编号和历史快照。 |
| 多套弹窗焦点、筛选和回跳处理 | [弹窗钩子](../../components/use-modal-dialog.ts)、[表头筛选](../../components/column-filter-header.tsx)、[回跳校验](../../lib/return-to.ts) | 界面入口可有不同的信息结构，键盘行为、控件契约和合法站内跳转有共用实现。 |
| 已无调用的表单错误助手及旧展示数据 | [Action 助手](../../lib/action-helpers.ts)、[状态元数据](../../lib/constants.ts) | 删除闲置声明和字段，错误反馈、标签和样式沿用当前页面引用的内容。 |
| 风险表单三处入口与 Action 会话检查 | [风险表单](../../components/risk-trial-entry-action.tsx)、[Action 助手](../../lib/action-helpers.ts) | 三处入口共用一个服务端表单。配置和流程 Action 共用会话与刷新规则。 |
| 部署与本机验证的脚本行为 | [部署脚本](../../scripts/deploy-ubuntu.sh)、[模拟回归](../../tests/deploy-ubuntu.sh) | systemd 检测和停启共用完整服务单元名。生产依赖和页面构建由同一个部署入口执行。 |

## 待核对的规范偏离

| 观察到的偏离或兼容例外 | 权威证据与待核对条件 |
| --- | --- |
| 多个集成测试责任田时，读取和办理分别使用不同范围。 | [授权矩阵](authorization.md)记录查询差异。实际业务规则和现存配置需确认。 |
| 历史批次可能关联另一项目的转测申请。 | [架构决策](decisions.md#历史批次关联按实际批次项目授权)记录兼容读取和同项目写入边界。修复历史记录需核对生产数据和业务含义。 |
| `binding_tasks`、`risk_reviews` 和 `formal_reviews` 仍参与部分历史读取和删除保护。 | [表结构](../../lib/schema.ts)、[优化任务池](backlog.md)。核对数据和调用方后决定迁移范围。 |
| 未提供停止命令且未识别到 systemd 单元时，部署脚本支持由外部先停止。 | [部署文档](../../README.md#ubuntu-24-生产部署)。是否要求外部明确声明已停服取决于生产进程管理方式。 |

变更实现或兼容约束时，更新对应条目及架构决策。在治理进度中记录实测过的范围。
