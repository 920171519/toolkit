# 流程授权与数据范围

[架构地图](README.md) · [业务逻辑与联动关系](../业务逻辑与联动关系.md)

系统账号只有管理员 `ADMIN` 和普通账号 `MEMBER`。普通账号按项目、责任田和具体业务记录上的当前分工获得权限，可同时兼任多个职责。`lib/auth.ts` 校验会话及账号启停，每次请求读取当前账号状态。PM 可作为项目联系人，其他权限由实际分工决定。

## 读取权限

| 对象 | 适用分工与读取范围 | 实现入口 |
| --- | --- | --- |
| 公开联系人 | 无需登录。列出未归档项目及该项目的 PM、软件经理。 | [`getPublicProjects`](../../lib/project-queries.ts) |
| 项目基础资料 | 登录后可浏览所有项目的基础资料和阶段，包括归档项目。 | [`getProjectCatalogEntries`](../../lib/project-queries.ts)、[项目详情](../../app/(workspace)/projects/[id]/page.tsx) |
| 项目工作区 | 管理员，以及本项目软件经理、集成测试责任田主管或本项目的集成测试责任田负责人和成员。查询可在需要历史记录时显式包含归档项目。 | [`getProjectWorkflowProjectIds`、`canAccessProjectPage`](../../lib/access.ts)、[项目范围路由](../../lib/project-scope.ts) |
| 批次及其报告 | 已发起批次沿用项目工作区范围，草稿限制为本项目软件经理和管理员。比对分别验证当前批次与基准；报告尚未关联批次时，普通账号仅可下载本人上传的报告。 | [`canReadBatchEvidence`](../../lib/access.ts)、[批次对比](../../lib/batch-comparison.ts)、[报告接口](../../app/api/reports/[id]/route.ts) |
| 软件包及版本 | 工作区分工、软件包责任人、该版本提交人、该包责任田主管、与使用项目匹配的责任田负责人或成员，以及具体绑定指派，按对象及证据获得读取权限。可读软件包可能在没有可读版本的情况下展示基础资料。项目过滤能匹配可读软件包时，仍可使用项目筛选。 | [`getReadablePackageIds`、`getReadableVersionIds`、`getNarrowVersionRequestIds`](../../lib/access.ts)、[软件包抽屉](../../lib/package-drawer-data.ts)、[版本全链路](../../lib/workflow-queries.ts) |
| 节点及电子流 | 有项目工作区权限或为软件包责任人时可读完整试制详情。否则节点责任人可看已推送的本节点，电子流审批人及提交人只可看各自关联的电子流。 | [`getReadableTrialDetail`](../../lib/workflow-queries.ts) |

## 办理权限

| 操作 | 适用分工 | 实现入口 |
| --- | --- | --- |
| 提交转测 | 管理员或软件包所属责任田的主管、项目负责人、项目成员。还需满足软件包启用和在行使用范围等条件。 | [`canSubmitTransferForArea`](../../lib/access.ts)、[`submitTransfer`](../../lib/workflow.ts) |
| 管理批次及登记风险试制 | 本项目软件经理或管理员。办理时重新校验项目和批次状态。 | [`canManageProjectWorkflowForProject`](../../lib/access.ts)、[`assertProjectManager`](../../lib/workflow.ts) |
| 提交集成测试进展和结论 | 管理员、集成测试责任田主管或本项目的集成测试责任田负责人。 | [`canSubmitIntegrationConclusionForProject`](../../lib/access.ts)、[工作流服务](../../lib/workflow.ts) |
| 共享试制、整版绑定决策及共享转正 | 管理员或有适用在行项目分工的软件经理。资格和同步范围按阶段校验。风险登记的项目范围与共享发布的范围分别校验。 | [`releaseTrial`、`pushBindingTasks`、`skipBindingAndEnterFormal`、`releaseFormal`](../../lib/workflow.ts) |
| 提交、审批及撤销绑定电子流 | 节点绑定责任人或管理员可提交。该电子流指派的审批人或管理员可审批，均不得自审。提交人、本项目软件经理或管理员可在允许的状态下登记撤销。 | [`canSubmitBindingFlow`、`canApproveBindingFlow`](../../lib/permissions.ts)、[工作流服务](../../lib/workflow.ts) |
| 判定条码、确认节点 | 软件包责任人、该节点所属项目的软件经理或管理员。 | [`canConfirmBindingNodeForProject`](../../lib/access.ts)、[工作流服务](../../lib/workflow.ts) |
| 登记单节点免绑 | 该节点绑定责任人、本项目软件经理或管理员。 | [工作流服务](../../lib/workflow.ts) |
| 修改软件包责任信息 | 管理员、该包责任田主管或该责任田的项目负责人。抽屉编辑资格、软件包审计可见性和保存使用同一权限。 | [`canEditPackageResponsibility`](../../lib/access.ts)、[软件包抽屉](../../lib/package-drawer-data.ts)、[`updatePackageResponsibility`](../../lib/settings.ts) |
| 维护软件包配置和补录 | 管理员或相应责任田主管可维护软件包配置和导入历史版本。更正历史补录由管理员执行。 | [`canManagePackageArea`](../../lib/access.ts)、[配置服务](../../lib/settings.ts) |

## 合并规则前需核对的边界

- `getProjectWorkflowProjectIds` 和 `getManagedProjectScope` 的 `null` 表示管理员不受分工筛选，空数组表示普通账号没有该范围。前者含集成测试分工，后者按软件经理指派查询。软件经理范围默认排除归档项目并按项目顺序返回，配置与历史证据可显式包含归档项目并按项目 ID 返回。记录是否存在及能否进入下一步由调用方校验。
- 可读取软件包、单项申请、绑定节点或电子流时，可以通过相应对象详情查阅；直接打开项目工作区仍需项目权限。`requireWorkflowProject` 的对象范围例外依赖调用方先独立校验记录，再校验 URL 中的项目 ID 与记录一致。
- 集成测试工作区读取和工作台统计扫描所有标记为集成测试的责任田，办理授权读取 ID 最小的该类责任田。库结构当前允许多个此类标记，演示数据只建立一个。需用现有库数据核对重复标记的实际使用情况，再决定两种范围如何对齐。

改动后可使用 [指派授权](../../tests/e2e/assignment-authorization.spec.ts)、[项目范围](../../tests/e2e/project-scope.spec.ts)、[批次对比](../../tests/e2e/batch-comparison.spec.ts)、[绑定权限](../../tests/e2e/binding-controls.spec.ts) 和[软件包详情](../../tests/e2e/package-experience.spec.ts)中的对应场景回归。
