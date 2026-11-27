# 实现与约束清单

[架构与状态地图](README.md)列出模块和数据的所有者。[流程授权](authorization.md)记录读取和办理范围。[治理进度](progress.md)与[架构决策](decisions.md)记录验证和取舍，[优化任务池](backlog.md)跟踪待办。运行 `node scripts/check-architecture.mjs --graph` 从当前检出生成完整的源码依赖图。

## 技术方案

| 范围 | 当前方案与契约 | 验证入口 |
| --- | --- | --- |
| 界面与状态 | Next.js App Router 负责路由和首屏。React 客户端组件持有表单、筛选控件和选中状态。列表条件用 URL 恢复。Tailwind 与全局样式提供设计规范，原生 `dialog` 管理焦点。 | [界面规范](../../AGENTS.md#界面层级与文案)、[弹窗钩子](../../components/use-modal-dialog.ts)、[窄屏回归](../../tests/e2e/workspace-width.spec.ts) |
| 业务办理 | Server Action 处理会话、表单反馈和跳转。工作流服务负责权限、阶段、并行变更和事务写入。配置修改引起的范围联动复用转测申请服务。 | [工作流](../../lib/workflow.ts)、[转测申请](../../lib/transfer-requests.ts)、[流程回归](../../tests/e2e/workflow.spec.ts) |
| 软件包详情接口 | `GET /api/packages/[id]` 对未登录请求返回 401，包编号无法解析为整数时返回 400。包或项目不可读、项目参数重复或记录缺失时返回 404。成功 JSON 使用 `no-store`，和页面预加载共享授权投影。 | [接口](../../app/api/packages/[id]/route.ts)、[接口与抽屉回归](../../tests/e2e/package-experience.spec.ts) |
| 验证报告接口 | `GET /api/reports/[id]` 对未登录请求返回 401。报告权限沿用对应证据读取规则。无效编号、缺失、不可读或无法下载返回 404。成功响应保留 MIME 类型、文件名及 `private, no-store`。 | [接口](../../app/api/reports/[id]/route.ts)、[报告回归](../../tests/e2e/workflow.spec.ts) |
| 通知入口 | `GET /api/notifications/read` 使用 303 导航。未登录跳到登录。登录后按当前账号记录已读，再跳到校验后的站内路径，默认回工作台。 | [接口](../../app/api/notifications/read/route.ts)、[工作台回归](../../tests/e2e/dashboard.spec.ts) |
| 会话、授权与缓存 | Cookie 承载会话令牌，SQLite 保存会话与账号状态。React `cache` 在同一次服务端渲染中复用会话查询。项目、责任田和单据分别校验权限。配置和流程操作成功后通过 Action 助手刷新工作区布局。 | [认证](../../lib/auth.ts)、[Action 助手](../../lib/action-helpers.ts)、[指派授权回归](../../tests/e2e/assignment-authorization.spec.ts) |
| 数据访问与运行配置 | Node 内置 SQLite 启用外键、WAL 和 5 秒锁等待。启动迁移和跨表变更使用事务，失败回滚。业务事务没有自动重放。数据库、报告目录和演示数据开关共用运行配置。 | [连接与迁移](../../lib/db.ts)、[配置解析](../../lib/runtime-config.ts)、[运行与部署](../../README.md) |
| 错误、恢复与记录 | 领域错误转为可操作的表单反馈，未分类故障记录服务端日志。报告存储对文件和元数据分步失败执行补偿。业务审计通过当前写入连接保存，随事务提交或回滚。 | [领域错误](../../lib/domain-error.ts)、[报告存储](../../lib/report-storage.ts)、[业务审计](../../lib/audit-log.ts) |
| 构建与防回归 | 依赖按 pnpm 锁文件冻结。ESLint 和 TypeScript 依赖检查器校验应用入口、模块循环和路由范围。Playwright 使用隔离数据库和报告路径，GitHub Actions 在 Ubuntu 执行检查。Shell 测试用模拟命令验证部署顺序。 | [架构检查](../../scripts/check-architecture.mjs)、[Playwright 配置](../../playwright.config.ts)、[CI](../../.github/workflows/verify.yml) |

## 已统一的重复实现

| 原并行路径 | 当前权威入口 | 差异或证据 |
| --- | --- | --- |
| 早期服务与现行工作流 | [工作流服务](../../lib/workflow.ts) | 退役无现行调用的 `lib/services.ts`。历史记录仍可读取。 |
| 列表预加载与 HTTP 抽屉详情 | [抽屉投影](../../lib/package-drawer-data.ts) | 复用同一授权和投影，保留项目过滤及 HTTP 错误响应。 |
| 各列表的分页范围与应用入口参数 | [分页窗口](../../lib/list-pagination.ts) | 数组与 SQLite 使用同一窗口计算，各入口保留自己的 URL 参数。 |
| 不同页面维护的批次证据和试制门槛 | [证据授权](../../lib/access.ts)、[试制资格](../../lib/trial-eligibility.ts)、[转正检查](../../lib/trial-readiness.ts) | 流程条件由服务端复核，证据由实际所属项目授权。资格与证据展示各自保留对应的检查。 |
| 批次详情、表单和事务各自计算测试结论影响 | [集成测试结论规则](../../lib/integration-conclusion.ts) | 批次视图与事务共用并行风险试制识别，表单和事务共用影响选择条件。 |
| 逐包与列表查询上次转测版本 | [转测申请](../../lib/transfer-requests.ts) | 一个按项目和软件包范围执行的查询，草稿写入事务重新读取。 |
| 全量项目设置与软件包节点选择 | [项目选项与节点](../../lib/project-queries.ts) | 选择器复用项目列表与节点基础字段，按范围批量查询。审批人配置由节点详情读取。 |
| 配置目录和节点详情复用全量项目配置 | [项目设置查询](../../lib/project-queries.ts) | 目录读取可管理项目的摘要，项目详情读取单项目的节点及审批人数，节点详情读取目标节点和审批人名单。 |
| 从责任田完整配置提取软件包选项 | [责任田选项](../../lib/queries.ts) | 选项共用基础查询，按各入口的原排序显示。完整配置按单个责任田读取。 |
| 节点状态、条码统计与确认逻辑 | [节点办理状态](../../lib/binding-availability.ts)、[条码判定](../../lib/binding-barcode-results.ts) | 页面和事务使用同一统计与条件，失败原因沿用已有证据。 |
| 多套弹窗焦点、筛选和回跳处理 | [弹窗钩子](../../components/use-modal-dialog.ts)、[表头筛选](../../components/column-filter-header.tsx)、[回跳校验](../../lib/return-to.ts) | 界面入口可有不同的信息结构，键盘行为、控件契约和合法站内跳转有共用实现。 |
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
