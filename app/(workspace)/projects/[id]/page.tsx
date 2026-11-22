import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Boxes, FlaskConical, GitBranch, ShieldCheck } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { canAccessProjectPage } from "@/lib/access";
import { getPackageOverviewRows, getProjectCatalog, getProjectConfigs, parseFlash } from "@/lib/queries";
import { getProjectStage, PROJECT_STAGE_META } from "@/lib/project-stage";
import { workflowHref } from "@/lib/workflow-links";
import {
  getBatches,
  getPendingFormalVersions,
  getPendingTransferGroups,
  getTrialReadyVersions,
  getTrialVersions,
  getProjectVersionRows,
  getWorkflowProjectScope,
} from "@/lib/workflow-queries";
import { formatDateTime } from "@/lib/format";
import { PROJECT_STATUS_META, TRANSFER_REQUEST_STATUS_META } from "@/lib/constants";
import { Badge, BatchStatusPill, EmptyState, FlashMessage, PageHeader, StatusPill } from "@/components/ui";
import styles from "./project-workspace.module.css";

const versionStatusFallback: Record<string, { label: string; tone: string }> = {
  TRIAL: { label: "试制中", tone: "teal" },
  PENDING_FORMAL: { label: "待转正", tone: "orange" },
  FORMAL: { label: "已转正", tone: "emerald" },
  VOID: { label: "已作废", tone: "slate" },
  CANCELLED: { label: "已取消", tone: "slate" },
};

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "项目工作区" };

export default async function ProjectWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const projectId = Number(id);
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(projectId) || projectId < 1) notFound();
  const [catalogEntry] = getProjectCatalog(projectId);
  if (!catalogEntry) notFound();
  const search = await searchParams;
  const notice = parseFlash(search.flash, search.tone === "error" ? "error" : "success");
  const allowedProjects = getWorkflowProjectScope(user);
  const hasWorkflowScope = allowedProjects === null || allowedProjects.includes(projectId);
  const canViewArchivedHistory = user.role === "SOFTWARE_MANAGER" && catalogEntry.status === "ARCHIVED";
  const canRead = canAccessProjectPage(user, projectId) && (hasWorkflowScope || canViewArchivedHistory);
  const stage = PROJECT_STAGE_META[getProjectStage(catalogEntry.status, catalogEntry.stage)].label;

  if (!canRead) {
    return (
      <>
        <PageHeader title={catalogEntry.name} description={catalogEntry.code} />
        <FlashMessage notice={notice} />
        <section className="card" aria-label="项目基本资料">
          <div className="card-body">
            <dl className={styles.projectIdentity}>
              <div><dt className="label">阶段</dt><dd>{stage}</dd></div>
              <div><dt className="label">PM</dt><dd>{catalogEntry.pms.map((person) => person.name).join("、") || "待指定"}</dd></div>
              <div><dt className="label">软件经理</dt><dd>{catalogEntry.softwareManagers.map((person) => person.name).join("、") || "待指定"}</dd></div>
            </dl>
            <p className="small muted">当前账号可查看项目基本资料。查看软件包和流转记录需要项目流程权限。</p>
          </div>
        </section>
      </>
    );
  }

  const [project] = getProjectConfigs(projectId);
  if (!project) notFound();
  const scope = hasWorkflowScope ? [projectId] : [];
  const pendingGroup = getPendingTransferGroups(scope)[0];
  const batches = getBatches(200, scope);
  const ready = getTrialReadyVersions(scope);
  const trials = getTrialVersions(scope);
  const formal = getPendingFormalVersions(scope);
  const packageRows = getPackageOverviewRows(projectId, true);
  const projectVersions = getProjectVersionRows(projectId);
  const activeBatches = batches.filter((batch) => batch.status === "IN_TEST");
  const visibleBatches = [...activeBatches, ...batches.filter((batch) => batch.status !== "IN_TEST")];
  const overdueTrials = trials.filter((version) => version.isOverdue).length;
  const overdueFormal = formal.filter((version) => version.isOverdue).length;

  return (
    <>
      <PageHeader
        title={project.name}
        description={`${project.code} · ${project.description || "项目工作区"}`}
        actions={hasWorkflowScope ? <Link href={workflowHref("/versions", projectId)} className="button button-secondary">版本全链路</Link> : undefined}
      />
      <FlashMessage notice={notice} />
      <div className="project-head card" style={{ marginBottom: 16 }}>
        <div className="card-body" style={{ padding: 18 }}>
          <div className="toolbar-spread" style={{ alignItems: "flex-start" }}>
            <div>
              <div className="toolbar" style={{ gap: 8, flexWrap: "wrap" }}>
                <span className="chip">{stage}</span>
                <Badge tone={PROJECT_STATUS_META[project.status].tone} dot>{PROJECT_STATUS_META[project.status].label}</Badge>
                <span className="chip">PM {project.pms.map((person) => person.name).join(" / ") || "待指定"}</span>
                <span className="chip">软件经理 {project.softwareManagers.map((person) => person.name).join(" / ") || "待指定"}</span>
                <span className="chip">{project.packageCount} 个软件包 · {project.nodes.length} 个节点</span>
              </div>
            </div>
            <div className="toolbar" style={{ gap: 14 }}>
              <Link href="#packages" className="archive-link">软件包范围</Link>
              <Link href="#transfers" className="archive-link">转测申请</Link>
              <Link href="#batches" className="archive-link">集成测试</Link>
              <Link href="#trials" className="archive-link">试制绑定</Link>
              <Link href="#formal" className="archive-link">转正</Link>
              <Link href="#versions" className="archive-link">版本记录</Link>
            </div>
          </div>
        </div>
      </div>

      <dl className={styles.flowSummary} aria-label="当前流程">
        <div className={styles.stage}>
          <dt>转测</dt>
          <dd><strong>{pendingGroup?.items.length ?? 0}</strong> 个待转测申请</dd>
        </div>
        <div className={styles.stage}>
          <dt>集成测试</dt>
          <dd><strong>{activeBatches.length}</strong> 个在测批次</dd>
        </div>
        <div className={styles.stage} data-overdue={overdueTrials > 0}>
          <dt>试制与绑定</dt>
          <dd><strong>{ready.length}</strong> 个待发试制</dd>
          <dd className={styles.stageDetail}>{trials.length} 个试制绑定中</dd>
          {overdueTrials > 0 && <dd className={styles.overdue}>{overdueTrials} 已超期</dd>}
        </div>
        <div className={styles.stage} data-overdue={overdueFormal > 0}>
          <dt>转正</dt>
          <dd><strong>{formal.length}</strong> 个待转正</dd>
          {overdueFormal > 0 && <dd className={styles.overdue}>{overdueFormal} 已超期</dd>}
        </div>
      </dl>

      <section id="packages" className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><div><h2 style={{ fontSize: 18 }}>软件包与全局使用范围</h2><p className="small muted" style={{ marginTop: 3 }}>即使在本项目页面，也展示软件包在所有在行项目中的使用范围，便于判断转测和绑定覆盖是否完整。</p></div><Badge tone="slate">{packageRows.length} 个</Badge></div>
        <div className="card-body" style={{ padding: 0, marginTop: 12 }}>
          {packageRows.length === 0 ? <EmptyState title="项目尚未关联软件包" description="请在软件包配置中维护本项目节点的使用范围。" /> : (
            <div className="table-wrap"><table className="data-table">
              <thead><tr><th>软件包</th><th>正式 / 试制 / 在途</th><th>本项目节点</th><th>全部项目使用范围</th><th aria-label="操作" /></tr></thead>
              <tbody>{packageRows.map((pkg) => (
                <tr key={pkg.id}>
                  <td><Link href={workflowHref("/packages", projectId, { open: pkg.id })} style={{ fontWeight: 600 }}>{pkg.name}</Link><div className="small muted">{pkg.code} · {pkg.areaName ?? "未归属"}</div></td>
                  <td><div className="small">正式 {pkg.formalVersion ?? "—"}</div><div className="small muted">试制 {pkg.trialVersions.join(" / ") || "—"} · 在途 {pkg.currentVersion ?? "—"}</div>{pkg.currentStatus && <StatusPill status={pkg.currentStatus} />}</td>
                  <td><div className="project-nodes" style={{ marginTop: 0 }}>{(pkg.usages.find((usage) => usage.projectId === projectId)?.nodeNames ?? []).map((node) => <span className="chip" key={node}>{node}</span>)}</div></td>
                  <td><div className="usage-scope-list">{pkg.usages.map((usage) => <span className="usage-scope" key={usage.projectId}><strong>{usage.projectName}</strong> {usage.nodeNames.join(" / ")}{usage.projectStatus === "ARCHIVED" && <span className="small muted">存档</span>}</span>)}</div></td>
                  <td className="cell-actions"><Link href={workflowHref("/packages", projectId, { open: pkg.id })} className="archive-link">详情 <ArrowRight size={11} /></Link></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      </section>

      <section id="transfers" className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><div><h2 style={{ fontSize: 18 }}>待转测申请</h2><p className="small muted" style={{ marginTop: 3 }}>本项目待安排转测的软件包版本。</p></div><Badge tone="amber">{pendingGroup?.items.length ?? 0}</Badge></div>
        <div className="card-body" style={{ paddingTop: 12 }}>
          {!pendingGroup || pendingGroup.items.length === 0 ? <EmptyState title="暂无待转测申请" /> : <div className="project-flow-list">{pendingGroup.items.map((item) => (
            <div className="project-flow-row" key={item.requestId}>
              <span style={{ fontWeight: 600 }}>{item.packageName}</span><span className="version-badge">{item.version}</span><span className="small muted">{item.changeSummary}</span>
              <Link href={workflowHref("/submissions", projectId)} className="archive-link" style={{ marginLeft: "auto" }}>去组织整套转测 <ArrowRight size={11} /></Link>
            </div>
          ))}<Link href={workflowHref("/submissions", projectId)} className="button button-secondary button-sm" style={{ marginTop: 10 }}>进入待转测申请页</Link></div>}
        </div>
      </section>

      <section id="batches" className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><div><h2 style={{ fontSize: 18 }}>集成测试批次</h2><p className="small muted" style={{ marginTop: 3 }}>本项目的在测批次和历史批次；测试结论、验证报告和进展说明在批次详情中。</p></div><Badge tone="sky">{activeBatches.length} 个在测</Badge></div>
        <div className="card-body" style={{ padding: 0, marginTop: 12 }}>
          {visibleBatches.length === 0 ? <EmptyState title="暂无集成测试批次" /> : <div className="table-wrap"><table className="data-table">
            <thead><tr><th>批次</th><th>状态</th><th>配套 / 变更</th><th>结论</th><th>发起 / 完成</th><th aria-label="操作" /></tr></thead>
            <tbody>{visibleBatches.map((batch) => (
              <tr key={batch.id}><td><Link href={workflowHref(`/integration/${batch.id}`, projectId)} className="archive-link mono">{batch.code}</Link><div className="small muted">{batch.title}</div></td><td><BatchStatusPill status={batch.status as "DRAFT" | "IN_TEST" | "COMPLETED" | "TERMINATED"} /></td><td><span className="mono small">{batch.itemCount} / {batch.changedCount}</span></td><td>{batch.conclusion ? <Badge tone={batch.conclusion === "PASS" ? "emerald" : "rose"}>{batch.conclusion === "PASS" ? "测试通过" : batch.conclusion === "FAIL" ? "测试不通过" : "无法验证"}</Badge> : <span className="small muted">—</span>}</td><td className="small muted">{formatDateTime(batch.sentAt ?? batch.createdAt)}</td><td className="cell-actions"><Link href={workflowHref(`/integration/${batch.id}`, projectId)} className="archive-link">查看 <ArrowRight size={11} /></Link></td></tr>
            ))}</tbody>
          </table></div>}
        </div>
      </section>

      <section id="trials" className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><div><h2 style={{ fontSize: 18 }}>试制与绑定验证</h2><p className="small muted" style={{ marginTop: 3 }}>本项目待发布试制和正在绑定验证的版本；试制按软件包版本全项目共享。</p></div><Badge tone="violet">{ready.length + trials.length}</Badge></div>
        <div className="card-body" style={{ paddingTop: 12 }}>
          {ready.length === 0 && trials.length === 0 ? <EmptyState title="暂无待发试制或绑定中的版本" /> : <div className="project-flow-stack">
            {ready.map((version) => <div className="project-flow-row" key={`ready-${version.requestId}`}><GitBranch size={13} /><span style={{ fontWeight: 600 }}>{version.packageName}</span><span className="version-badge">{version.version}</span><Badge tone={version.riskProjectCount > 0 ? "rose" : "violet"}>{version.riskProjectCount > 0 ? "风险发布" : "待发试制"}</Badge><span className="small muted">覆盖 {version.versionProjectCount} 个项目</span><Link href={workflowHref("/trial", projectId)} className="archive-link" style={{ marginLeft: "auto" }}>去发布试制 <ArrowRight size={11} /></Link></div>)}
            {trials.map((version) => <div className="project-flow-row" key={`trial-${version.requestId}`}><FlaskConical size={13} /><span style={{ fontWeight: 600 }}>{version.packageName}</span><span className="version-badge">{version.version}</span><Badge tone={version.releaseMode === "RISK" ? "rose" : "teal"}>{version.releaseMode === "RISK" ? "风险发布" : "绑定中"}</Badge><span className="small muted">节点 {version.requirementPassed}/{version.requirementTotal} · 待审批 {version.pendingFlowCount}</span>{version.isOverdue ? <Badge tone="rose">已超期</Badge> : null}{version.bindingMode === "PENDING" ? <Badge tone="amber">待推送绑定</Badge> : version.bindingMode === "SKIPPED" ? <Badge tone="slate">跳过绑定</Badge> : <Badge tone="teal">绑定已推送</Badge>}<Link href={workflowHref(`/trial/${version.requestId}`, projectId)} className="archive-link" style={{ marginLeft: "auto" }}>处理绑定 <ArrowRight size={11} /></Link></div>)}
          </div>}
        </div>
      </section>

      <section id="versions" className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><div><h2 style={{ fontSize: 18 }}>项目版本流程记录</h2><p className="small muted" style={{ marginTop: 3 }}>本项目所有转测版本的当前状态、集成结论、试制和转正记录；每个版本可进入全链路追溯。</p></div><Badge tone="slate">{projectVersions.length} 个版本</Badge></div>
        <div className="card-body" style={{ padding: 0, marginTop: 12 }}>
          {projectVersions.length === 0 ? <EmptyState title="暂无项目版本记录" /> : <div className="table-wrap"><table className="data-table">
            <thead><tr><th>软件包 / 版本</th><th>流程状态</th><th>集成批次 / 结论</th><th>试制电子流</th><th>转正电子流</th><th aria-label="操作" /></tr></thead>
            <tbody>{projectVersions.map((version) => {
              const meta = versionStatusFallback[version.status] ?? TRANSFER_REQUEST_STATUS_META[version.status as keyof typeof TRANSFER_REQUEST_STATUS_META] ?? { label: version.status, tone: "slate" };
              return <tr key={version.requestId}>
                <td><Link href={workflowHref(`/versions/${version.versionId}`, projectId)} style={{ fontWeight: 600 }}>{version.packageName}</Link><div className="small muted">{version.packageCode} · {version.version}</div></td>
                <td><Badge tone={meta.tone as "emerald" | "rose" | "amber" | "slate" | "sky" | "violet" | "orange"}>{meta.label}</Badge>{version.isOverdue ? <div style={{ marginTop: 4 }}><Badge tone="rose">已超期</Badge></div> : null}{version.bindingMode === "PENDING" && version.status === "TRIAL" ? <div style={{ marginTop: 4 }}><Badge tone="amber">待推送绑定</Badge></div> : null}{version.riskConclusion && <div className="small muted">风险结论：{version.riskConclusion.slice(0, 24)}{version.riskConclusion.length > 24 ? "…" : ""}</div>}</td>
                <td>{version.batchId ? <Link href={workflowHref(`/integration/${version.batchId}`, projectId)} className="archive-link"><span className="mono">{version.batchCode}</span> · {version.batchConclusion ?? "进行中"} <ArrowRight size={11} /></Link> : <span className="small muted">无批次</span>}</td>
                <td className="small mono">{version.trialFormNo ?? "—"}</td>
                <td className="small mono">{version.formFlowNo ?? "—"}</td>
                <td className="cell-actions"><div className="toolbar" style={{ justifyContent: "flex-end", gap: 8 }}><Link href={workflowHref(`/versions/${version.versionId}`, projectId)} className="archive-link">全链路</Link>{["TRIAL", "PENDING_FORMAL", "FORMAL"].includes(version.status) && <Link href={workflowHref(`/trial/${version.requestId}`, projectId)} className="archive-link">绑定</Link>}</div></td>
              </tr>;
            })}</tbody>
          </table></div>}
        </div>
      </section>

      <section id="formal" className="card">
        <div className="card-header"><div><h2 style={{ fontSize: 18 }}>待转正</h2><p className="small muted" style={{ marginTop: 3 }}>本项目版本全部绑定通过后进入待转正；转正按软件包版本全项目共享。</p></div><Badge tone="orange">{formal.length}</Badge></div>
        <div className="card-body" style={{ paddingTop: 12 }}>
          {formal.length === 0 ? <EmptyState title="暂无待转正版本" /> : <div className="project-flow-stack">{formal.map((version) => (
            <div className="project-flow-row" key={`formal-${version.requestId}`}><ShieldCheck size={13} /><span style={{ fontWeight: 600 }}>{version.packageName}</span><span className="version-badge">{version.version}</span><span className="small muted">{version.requirementTotal === 0 ? "无需绑定验证" : `绑定节点 ${version.requirementPassed}/${version.requirementTotal} 通过`}</span>{version.isOverdue ? <Badge tone="rose">已超期</Badge> : null}<Link href={workflowHref("/formal", projectId)} className="archive-link" style={{ marginLeft: "auto" }}>去转正 <ArrowRight size={11} /></Link></div>
          ))}</div>}
        </div>
      </section>

      <div className="muted-panel" style={{ marginTop: 16 }}><Boxes size={14} style={{ display: "inline", marginRight: 5, verticalAlign: -2 }} />项目工作区只展示本项目流程；软件包使用范围始终展示全部在行项目，便于判断转测配套和绑定验证是否覆盖完整。</div>
    </>
  );
}
