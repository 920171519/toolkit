# 工程协同台架构

[治理进度](progress.md) · [架构决策](decisions.md) · [优化任务池](backlog.md) · [实现与约束清单](inventory.md) · [流程授权](authorization.md) · [业务逻辑与联动关系](../业务逻辑与联动关系.md)

架构记录以 `4a6a308` 为首轮基线。页面和测试证明实际入口，数据库迁移和接口响应证明数据契约。需求细节沿用业务文档。下表指向实现和状态的所有者。

| 区域 | 主要模块 | 职责和依赖方向 |
| --- | --- | --- |
| 公开目录、登录和项目导航 | `app/page.tsx`、`app/(auth)`、`app/(workspace)/layout.tsx`、`components/workspace-navigation.tsx` | App Router 组合页面。公开目录读取在行项目联系人。工作区渲染登录状态和已授权的项目入口。 |
| 页面和交互 | `app/(workspace)`、`components`、`app/globals.css`、`app/site.css`、局部 CSS Modules | Server Component 负责查询和首屏。客户端控件拥有表单、焦点、选中及展开状态。原生模态和焦点恢复由 `components/use-modal-dialog.ts` 管理。页面间筛选和返回条件通过 URL 传递。 |
| 锚定弹层 | `components/popover-viewport.ts` | 共用视口范围、横向定位和事件清理。帮助提示与表头筛选各自管理打开、关闭和焦点。 |
| 发布写入 | `lib/actions/workflow.ts`、`lib/actions/risk-trial.ts` → `lib/release-workflow.ts` | Server Action 解析表单并返回反馈。风险登记的三处入口共用服务端表单投影和办理适配。工作流模块校验权限和业务条件，通过 SQLite 事务更新状态、证据和审计。 |
| 批次写入 | `lib/actions/workflow.ts` → `lib/batch-workflow.ts` | 处理转测批次、测试进展、结论与报告。版本作废记录从 `lib/version-void-workflow.ts` 共用。 |
| 转测写入 | `lib/actions/workflow.ts` → `lib/transfer-workflow.ts` | 处理提交软件包版本、为在行使用项目生成申请和撤回，沿用责任范围及历史引用保护。 |
| 绑定写入 | `lib/actions/workflow.ts` → `lib/binding-workflow.ts` | 维护绑定决策、节点与电子流写入，沿用事务和各操作的业务校验。 |
| 配置写入 | `lib/actions/settings.ts` → `lib/settings.ts` | 管理账号分工、责任田、项目节点、软件包及补录。配置变更触发的流程联动例见 `lib/transfer-requests.ts`。 |
| 配置读取 | `lib/settings-queries.ts`、`lib/project-queries.ts`、`lib/queries.ts` | 界面和设置写入事务共用配置引用、阻塞与补录查询。表单入口选择相应资料投影。 |
| 工作台读取 | `lib/workbench-queries.ts` | 按角色和项目组合待办、提醒、个人版本和电子流，复用各队列及通知模块。 |
| 版本追溯读取 | `lib/version-trace-queries.ts` | 负责版本列表、追溯标签和项目版本活动，按原权限投影批次、报告及绑定证据。 |
| 工作流规则和引导 | `lib/batch-comparison.ts`、`lib/release-guidance.ts` | 准备转测与草稿事务在 `lib/transfer-requests.ts` 共用上次转测版本读取。`lib/trial-eligibility.ts` 为队列、引导和事务提供共享试制资格。转正引导与发布事务共用 `lib/trial-readiness.ts` 的转正检查。 |
| 批次读取 | `lib/batch-queries.ts` | 为转测准备、集成测试、项目最近批次和报告接口生成带读取权限的视图。 |
| 待转测读取 | `lib/pending-transfer-queries.ts`、`lib/transfer-requests.ts` | 管理申请清单、项目计数和工作台预览，复用现有申请范围及草稿占用规则。 |
| 发布队列读取 | `lib/release-queue-queries.ts` | 为已发试制、待转正、项目计数和可读历史提供查询。 |
| 绑定读取 | `lib/binding-queries.ts` | 为试制、转正和版本追溯提供授权后的节点、条码与电子流证据，缓存同一页面读取期间的详情。 |
| 目录、详情与接口 | `lib/project-queries.ts`、`lib/queries.ts`、`app/api/packages/[id]`、`app/api/reports/[id]` | 项目目录、联系人和配置由项目查询模块投影。路由处理认证、参数、状态码、下载及缓存控制。软件包抽屉的页面预加载和 HTTP 入口共用已授权的详情投影。 |
| 身份和授权 | `lib/auth.ts`、`lib/access.ts`、`lib/permissions.ts`、`lib/project-scope.ts` | 认证服务控制注册、登录及 Cookie，`session-store` 负责会话存储和校验。`access` 管理项目、责任田、软件包、节点和单据的读写范围及批次证据权限。版本对象读取、项目工作区和写入办理各有权限。 |
| 通知已读 | `lib/notification-reads.ts` | 通知链接记录当前账号的首次打开时间，工作台按同一模块查询已读键。 |
| 存储、兼容和报告 | `lib/db.ts`、`lib/schema.ts`、`lib/seed.ts`、`lib/report-storage.ts` | `db` 负责连接和启动迁移。`sqlite-lifecycle` 为迁移、应用和补派命令提供即时写事务及失败清理。演示数据经显式环境变量关闭。报告存储统一路径、文件读写和失败清理，报告元数据存入 SQLite。 |
| 配置与部署 | `lib/runtime-config.ts`、`package.json`、`next.config.ts`、`scripts/deploy-ubuntu.sh` | 应用和维护命令共用数据库路径、报告目录和演示数据开关的解析规则。README 记录进程环境和工作目录。部署脚本接入现有进程管理器。 |
| 错误、日志与测试 | `lib/domain-error.ts`、`lib/action-helpers.ts`、`lib/audit-log.ts`、`tests/e2e` | 业务校验使用同一错误类型。`audit-log` 在调用方现有事务和连接上写入操作历史。Playwright 从真实页面、权限及数据库状态验证契约。测试服务与夹具共享同一运行目录中的数据库和报告。 |

## 状态所有权

| 概念 | 权威记录 | 所有者 |
| --- | --- | --- |
| 登录和业务分工 | `sessions`、`users`、项目和责任田分工表 | `auth`、`access`、`settings`。Cookie 承载会话，下一次请求按服务端记录校验。 |
| 软件包身份和使用范围 | `packages`、`package_usages` | `settings` 写入。`package-identity` 投影旧资料中的编码与名称，流程关联继续按 ID。 |
| 共享版本状态 | `package_versions` | `release-workflow` 办理共享试制及转正，`version-void-workflow` 负责写入作废记录。 |
| 项目办理状态与验收事实 | `version_transfer_requests.status`、`integration_status` | `transfer-workflow` 创建申请，`batch-workflow` 写入验收，`release-workflow` 更新发布状态。两种状态描述各自的事实，试制与转正资格使用项目验收和版本证据。 |
| 批次与完整配套 | `integration_batches`、`batch_items` | `batch-workflow` 保存状态和版本快照。批次对比读取两份快照。`integration-conclusion` 定义受影响版本的选择规则。 |
| 节点、审批和逐条判定 | `binding_requirements`、`binding_flows`、`binding_flow_barcodes` | `release-workflow` 保存试制时的配置快照，`binding-workflow` 写入后续绑定和节点结果。`binding-availability` 定义绑定办理所需的发布阶段和节点状态，`binding-barcode-results` 定义条码统计和确认门槛，`trial-readiness` 根据已保存的节点确认、免绑及流程证据计算转正条件。 |
| 审计和报告 | `audit_logs`、`report_files`、上传文件 | 写入模块记录操作。`report-storage` 与报告路由共同负责文件读写路径和读取权限。 |
| 通知已读 | `notification_reads` | `notification-reads` 按账号和通知键保存首次已读时间。 |
| 目录和流程筛选 | URL 参数、浏览器当前页面状态 | 各列表保留既有 URL 参数。`lib/list-pagination.ts` 统一计算筛选后分页范围，数组和 SQLite 分页都使用该结果。准备批次的跨页勾选由 `components/pending-batch-choices.tsx` 管理，保存草稿后以服务端快照为准。 |

## 依赖约束

`pnpm lint` 同时运行 ESLint 和 `pnpm architecture:check`。检查器使用当前 TypeScript 配置解析源码中的静态导入、导出、类型导入、字面量动态导入和 CommonJS 导入。JS/TS 源码循环会导致命令失败，同时打印可定位的路径。检查覆盖应用、交互、业务、脚本、测试和根目录源码配置。生成文件、外部包与 CSS 资源不进入模块图。

运行 `node scripts/check-architecture.mjs --graph` 可导出当前完整的内部模块依赖表。基线扫描覆盖 187 个模块、773 条含类型引用的内部依赖，未发现循环。后续约束以实际依赖和被保留的契约为依据。

软件包抽屉的授权投影由 `getPackageDrawerData` 提供。ESLint 会拦截页面和客户端模块直接导入通用查询中的底层详情读取函数。

页面、布局、组件、HTTP 接口和业务 Action 通过服务端业务或查询模块访问数据。架构检查按解析后的模块核对 `app/`、`components/` 和 `lib/actions/` 的数据库依赖，拦截直接导入数据库连接或 `node:sqlite`。报告查询按批次读取权限投影证据，接口处理登录、状态码和下载。公开首页只读取在行项目联系人，登录后的目录和配置按各自范围读取归档项目。

`lib/release-workflow.ts`、`lib/binding-workflow.ts`、`lib/transfer-workflow.ts`、`lib/batch-workflow.ts` 和 `lib/version-void-workflow.ts` 从领域模块读取事务需要的事实。架构检查拦截这些写入模块直接依赖 `lib/workbench-queries.ts`、`lib/version-trace-queries.ts`、`lib/binding-queries.ts`、`lib/batch-queries.ts`、`lib/pending-transfer-queries.ts` 和 `lib/release-queue-queries.ts`，也拦截工作区页面直接导入写入模块。领域模块可以同时服务工作流事务和页面查询，页面通过 Server Action 执行写入。设置的页面、组件、软件包抽屉数据适配与其他 Action 从查询模块读取配置证据，通过设置 Action 办理写入。架构检查拦截这些入口直接引用设置写入模块。应用中的会话存储调用来自认证和设置模块。

架构检查同时核对工作区的实际页面、`lib/return-to.ts` 回跳范围和 `proxy.ts` 的静态 matcher。项目总览表头和返回地址共用 `lib/project-overview-filters.ts` 的列定义，责任田、软件包和人员目录共用 `lib/settings-directory.ts` 的定义。

## 自动验证

GitHub Actions 在 Ubuntu 24.04 上先用 `bash tests/deploy-ubuntu.sh` 验证部署顺序，再用 Node.js 24.19.0 和 pnpm 11.19.0 冻结安装，执行 `pnpm lint`、`pnpm test:e2e:full` 和 `pnpm typecheck`。部署测试使用模拟命令，浏览器回归使用隔离的演示数据库和报告目录。本机可用相同命令复验。 [工作流配置](../../.github/workflows/verify.yml)
