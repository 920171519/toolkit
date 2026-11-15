import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Boxes, FlaskConical, Layers3 } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getAuditLogs, getPackagesOverview, getPublicProjects } from "@/lib/queries";
import {
  getBatches,
  getPendingFormalVersions,
  getPendingTransferGroups,
  getProjectOptions,
  getTrialReadyVersions,
  getTrialVersions,
} from "@/lib/workflow-queries";
import { formatDateTime, formatRelative } from "@/lib/format";
import { Badge, BatchStatusPill, EmptyState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "部门总览" };

export default async function OverviewPage() {
  await requireUser();
  const packages = getPackagesOverview();
  const projects = getProjectOptions();
  const pendingGroups = getPendingTransferGroups();
  const pendingCount = pendingGroups.reduce((total, group) => total + group.items.length, 0);
  const batches = getBatches(100);
  const activeBatches = batches.filter((batch) => batch.status === "IN_TEST");
  const pendingTrial = getTrialReadyVersions();
  const trialVersions = getTrialVersions();
  const pendingFormal = getPendingFormalVersions();
  const contacts = getPublicProjects();
  const activities = getAuditLogs(8);
  const stages = [
    { label: "待组织转测", value: pendingCount, href: "/submissions", tone: "amber" as const },
    { label: "集成测试中", value: activeBatches.length, href: "/integration", tone: "sky" as const },
    { label: "待发布试制", value: pendingTrial.length, href: "/trial", tone: "violet" as const },
    { label: "绑定验证中", value: trialVersions.length, href: "/trial", tone: "teal" as const },
    { label: "待转正", value: pendingFormal.length, href: "/formal", tone: "orange" as const },
    { label: "已全量转正", value: packages.filter((pkg) => pkg.formalVersion).length, href: "/packages", tone: "emerald" as const },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Department overview"
        title="部门总览"
        description="查看项目、软件包与项目维度集成测试的整体运行情况。个人待办与异常提醒请回到“我的工作台”。"
        actions={<><Link href="/dashboard" className="button button-secondary">返回我的工作台</Link><Link href="/packages" className="button button-primary">软件版本总览 <ArrowRight size={14} /></Link></>}
      />
      <div className="metric-row">
        <div className="metric"><div className="metric-label">在行项目</div><div className="metric-value">{projects.length}</div><div className="metric-note">按项目独立组织配套</div></div>
        <div className="metric"><div className="metric-label">软件包</div><div className="metric-value">{packages.length}</div><div className="metric-note">含已停用软件包</div></div>
        <div className="metric"><div className="metric-label">待组织转测</div><div className="metric-value">{pendingCount}</div><div className="metric-note">分布在 {pendingGroups.length} 个项目</div></div>
        <div className="metric"><div className="metric-label">集成测试批次</div><div className="metric-value">{activeBatches.length}</div><div className="metric-note">支持多项目并行测试</div></div>
      </div>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="card-header"><div><h2 style={{ fontSize: 16 }}>版本流水线</h2><p className="small muted" style={{ marginTop: 3 }}>转测申请按项目分发，试制绑定覆盖全部在行项目节点。</p></div><Badge tone="slate">按项目 / 按配套</Badge></div>
        <div className="card-body"><div className="stage-strip">
          {stages.map((stage, index) => (
            <Link className="stage-cell" href={stage.href} key={stage.label}>
              <div className="stage-cell-index">0{index + 1}</div>
              <div className="stage-cell-name">{stage.label}</div>
              <div className="stage-cell-count">{stage.value}</div>
            </Link>
          ))}
        </div></div>
      </section>

      <div className="two-col" style={{ marginTop: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <section className="card">
            <div className="card-header"><div><h2 style={{ fontSize: 18 }}>测试中的项目批次</h2><p className="small muted" style={{ marginTop: 3 }}>不同项目独立排期，多台设备可并行验证。</p></div><FlaskConical size={17} style={{ color: "var(--brand)" }} /></div>
            <div className="card-body" style={{ paddingTop: 12 }}>
              {activeBatches.length === 0 ? <EmptyState title="当前没有测试中的批次" description="软件经理可以从待转测申请中组织项目配套。" /> : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {activeBatches.map((batch) => (
                    <Link href={`/integration/${batch.id}`} className="project-batch-row" key={batch.id}>
                      <div>
                        <div className="toolbar" style={{ gap: 7 }}><span className="mono" style={{ fontWeight: 700 }}>{batch.code}</span><BatchStatusPill status="IN_TEST" /><span className="chip">{batch.projectName}</span></div>
                        <div className="small muted" style={{ marginTop: 3 }}>{batch.title} · {batch.changedCount} 个变更包 · {formatDateTime(batch.sentAt)}</div>
                      </div>
                      <ArrowRight size={14} style={{ color: "var(--muted-light)" }} />
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="card">
            <div className="card-header"><div><h2 style={{ fontSize: 17 }}>最近流程动态</h2><Link href="/dashboard" className="archive-link">我的待办 <ArrowRight size={11} /></Link></div></div>
            <div className="card-body" style={{ paddingTop: 8 }}>
              <div className="timeline">
                {activities.map((activity) => (
                  <div className="timeline-item" key={activity.id}><span className="timeline-line" /><span className="timeline-dot" /><div><div className="timeline-title">{activity.detail}</div><div className="timeline-meta">{activity.actorName ?? "系统"} · {formatRelative(activity.createdAt)}</div></div></div>
                ))}
                {activities.length === 0 && <p className="muted small">暂无动态。</p>}
              </div>
            </div>
          </section>
        </div>

        <aside style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <section className="card">
            <div className="card-header"><div><h2 style={{ fontSize: 16 }}>项目联系人</h2></div><Layers3 size={16} style={{ color: "var(--muted-light)" }} /></div>
            <div className="card-body" style={{ paddingTop: 10 }}><div className="contact-grid" style={{ gridTemplateColumns: "1fr" }}>
              {contacts.map((project) => (
                <div className="contact-tile" key={project.id}><Boxes size={15} style={{ color: "var(--brand)" }} /><div className="person-inline-copy" style={{ flex: 1 }}><span className="person-inline-name">{project.name}</span><span className="person-inline-meta">PM {project.pmName ?? "—"} · 软件经理 {project.softwareManagerName ?? "—"}</span></div></div>
              ))}
            </div></div>
          </section>
          <section className="card card-muted"><div className="card-body"><h3 style={{ fontSize: 13 }}>项目节点绑定配置</h3><p className="note" style={{ marginTop: 6 }}>每个项目节点都需要指定设备条码绑定验证责任人和绑定电子流审批人，并设置绑定通过数量要求。</p><Link href="/settings/projects" className="archive-link" style={{ marginTop: 10 }}>前往项目配置 <ArrowRight size={11} /></Link></div></section>
        </aside>
      </div>
    </>
  );
}
