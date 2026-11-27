# 工程协同台架构

[治理进度](progress.md) · [架构决策](decisions.md) · [优化任务池](backlog.md) · [流程授权](authorization.md) · [业务逻辑与联动关系](../业务逻辑与联动关系.md)

架构记录以 `4a6a308` 为首轮基线。页面和测试证明实际入口，数据库迁移和接口响应证明数据契约。需求细节沿用业务文档。下表指向实现和状态的所有者。

| 区域 | 主要模块 | 职责和依赖方向 |
| --- | --- | --- |
| 公开目录、登录和项目导航 | `app/page.tsx`、`app/(auth)`、`app/(workspace)/layout.tsx`、`components/workspace-navigation.tsx` | App Router 组合页面。公开目录读取在行项目联系人。工作区渲染登录状态和已授权的项目入口。 |
| 页面和交互 | `app/(workspace)`、`components`、`app/globals.css`、`app/site.css`、局部 CSS Modules | Server Component 负责查询和首屏。客户端控件拥有表单、焦点、选中及展开状态。页面间筛选和返回条件通过 URL 传递。重点检查重复的列表与弹窗交互。 |
| 工作流写入 | `lib/actions/workflow.ts` → `lib/workflow.ts` | Server Action 解析表单并返回反馈。工作流模块校验权限和业务条件，通过 SQLite 事务更新状态、证据和审计。 |
| 配置写入 | `lib/actions/settings.ts` → `lib/settings.ts` | 管理账号分工、责任田、项目节点、软件包及补录。配置变更触发的流程联动例见 `lib/transfer-requests.ts`。 |
| 工作流读取 | `lib/workflow-queries.ts`、`lib/batch-comparison.ts`、`lib/release-guidance.ts` | 为工作台、批次、试制与绑定、转正和追溯生成各自视图。`lib/trial-eligibility.ts` 为队列、引导和事务提供共享试制资格。转正引导与发布事务共用 `lib/trial-readiness.ts` 的转正检查。 |
| 目录、详情与接口 | `lib/project-queries.ts`、`lib/queries.ts`、`app/api/packages/[id]`、`app/api/reports/[id]` | 项目目录、联系人和配置由项目查询模块投影。路由处理认证、参数、状态码、下载及缓存控制。软件包抽屉的页面预加载和 HTTP 入口共用已授权的详情投影。 |
| 身份和授权 | `lib/auth.ts`、`lib/access.ts`、`lib/permissions.ts`、`lib/project-scope.ts` | 会话识别用户。业务授权按项目、责任田、软件包、节点和单据检查。版本对象读取、项目工作区和写入办理各有权限。 |
| 存储、兼容和报告 | `lib/db.ts`、`lib/schema.ts`、`lib/seed.ts`、`lib/report-storage.ts` | `db` 统一连接、事务和启动迁移。演示数据经显式环境变量关闭。报告服务拥有路径校验，报告元数据存入 SQLite。 |
| 配置与部署 | `package.json`、`next.config.ts`、`scripts/deploy-ubuntu.sh`、README 环境变量表 | pnpm 固定依赖，Next.js 处理构建和运行，Node 原生 SQLite 提供存储。部署脚本接入现有进程管理器。生产路径和会话选项逐步归档至任务池。 |
| 错误、日志与测试 | `lib/domain-error.ts`、`lib/action-helpers.ts`、`audit_logs`、`tests/e2e` | 业务校验使用同一错误类型，操作历史随业务状态写入。Playwright 从真实页面、权限及数据库状态验证契约。测试服务与夹具共享同一运行目录中的数据库和报告。 |

## 状态所有权

| 概念 | 权威记录 | 所有者 |
| --- | --- | --- |
| 登录和业务分工 | `sessions`、`users`、项目和责任田分工表 | `auth`、`access`、`settings`。Cookie 承载会话，下一次请求按服务端记录校验。 |
| 软件包身份和使用范围 | `packages`、`package_usages` | `settings` 写入。`package-identity` 投影旧资料中的编码与名称，流程关联继续按 ID。 |
| 共享版本状态 | `package_versions` | `workflow` 更新共享试制、转正及作废。 |
| 项目办理状态与验收事实 | `version_transfer_requests.status`、`integration_status` | `workflow` 更新。两种状态描述各自的事实，试制与转正资格使用项目验收和版本证据。 |
| 批次与完整配套 | `integration_batches`、`batch_items` | `workflow` 保存状态和版本快照。批次对比读取两份快照。 |
| 节点、审批和逐条判定 | `binding_requirements`、`binding_flows`、`binding_flow_barcodes` | `workflow` 写入。`trial-readiness` 根据持久化证据计算转正条件。 |
| 审计和报告 | `audit_logs`、`report_files`、上传文件 | 写入模块记录操作。`report-storage` 与报告路由共同负责文件读写路径和读取权限。 |
| 目录和流程筛选 | URL 参数、浏览器当前页面状态 | 各列表保留既有 URL 参数。`lib/list-pagination.ts` 统一计算筛选后分页范围，数组和 SQLite 分页都使用该结果。准备批次的跨页勾选由 `components/pending-batch-choices.tsx` 管理，保存草稿后以服务端快照为准。 |

## 依赖约束

`pnpm lint` 同时运行 ESLint 和 `pnpm architecture:check`。检查器使用当前 TypeScript 配置解析源码中的静态导入、导出、类型导入和字面量动态导入。JS/TS 源码循环会导致命令失败，同时打印可定位的路径。检查覆盖应用、交互、业务、脚本、测试和根目录源码配置。生成文件、外部包与 CSS 资源不进入模块图。

运行 `node scripts/check-architecture.mjs --graph` 可导出当前完整的内部模块依赖表。基线扫描覆盖 187 个模块、773 条含类型引用的内部依赖，未发现循环。后续约束以实际依赖和被保留的契约为依据。

软件包抽屉的授权投影由 `getPackageDrawerData` 提供。ESLint 会拦截页面和客户端模块直接导入通用查询中的底层详情读取函数。

页面、布局、组件和报告读取接口通过服务端查询模块获取数据。ESLint 拦截这些入口直接导入数据库连接或 `node:sqlite`。报告查询按批次读取权限投影证据，接口处理登录、状态码和下载。公开首页只读取在行项目联系人，登录后的目录和配置按各自范围读取归档项目。
