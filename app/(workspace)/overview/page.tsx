import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Building2, Layers3, Package, UsersRound } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getProjectConfigs } from "@/lib/queries";
import {
  getBatches,
  getPendingFormalVersions,
  getPendingTransferGroups,
  getTrialReadyVersions,
  getTrialVersions,
  getWorkflowProjectScope,
} from "@/lib/workflow-queries";
import { PROJECT_STATUS_META } from "@/lib/constants";
import { formatDateTime } from "@/lib/format";
import { Badge, EmptyState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "部门总览" };

export default async function OverviewPage() {
  const user = await requireUser();
  const scope = getWorkflowProjectScope(user);
  const scopeSet = scope ? new Set(scope) : null;
  const projects = getProjectConfigs().filter(
    (project) => !scopeSet || scopeSet.has(project.id),
  );
  const pendingGroups = getPendingTransferGroups(scope);
  const batches = getBatches(200, scope);
  const trialReady = getTrialReadyVersions(scope);
  const trials = getTrialVersions(scope);
  const pendingFormal = getPendingFormalVersions(scope);
  const pendingByProject = new Map(pendingGroups.map((group) => [group.projectId, group.items.length]));
  const activeBatchByProject = new Map<number, number>();
  for (const batch of batches.filter((item) => item.status === "IN_TEST")) {
    activeBatchByProject.set(batch.projectId, (activeBatchByProject.get(batch.projectId) ?? 0) + 1);
  }
  const readyByProject = new Map<number, number>();
  for (const item of trialReady) readyByProject.set(item.projectId, (readyByProject.get(item.projectId) ?? 0) + 1);
  const trialByProject = new Map<number, number>();
  for (const item of trials) trialByProject.set(item.projectId, (trialByProject.get(item.projectId) ?? 0) + 1);
  const formalByProject = new Map<number, number>();
  for (const item of pendingFormal) formalByProject.set(item.projectId, (formalByProject.get(item.projectId) ?? 0) + 1);

  return (
    <>
      <PageHeader
        eyebrow="Department overview"
        title="部门总览"
        description="按行查看各项目当前状态；点击项目进入项目页面，查看该项目的软件包、转测、集成测试、试制绑定和转正全部信息。"
        actions={<Link href="/packages" className="button button-primary">软件版本总览 <ArrowRight size={14} /></Link>}
      />
      <div className="info-strip" style={{ marginBottom: 16 }}>
        <span><strong>{projects.length}</strong> 个项目</span>
        <span><strong>{pendingGroups.reduce((sum, group) => sum + group.items.length, 0)}</strong> 个待转测申请</span>
        <span><strong>{batches.filter((batch) => batch.status === "IN_TEST").length}</strong> 个在测批次</span>
        <span><strong>{trialReady.length}</strong> 个待发试制</span>
        <span><strong>{pendingFormal.length}</strong> 个待转正</span>
      </div>

      <section className="card">
        <div className="card-header"><div><h2 style={{ fontSize: 18 }}>项目列表</h2><p className="small muted" style={{ marginTop: 3 }}>点击项目行进入项目工作区；所有项目级流程都在项目页面内查看。</p></div><Badge tone="slate">{projects.length} 个</Badge></div>
        <div className="card-body" style={{ padding: 0, marginTop: 12 }}>
          {projects.length === 0 ? (
            <EmptyState title="暂无可查看项目" description="管理员创建项目后，会按行显示在这里。" />
          ) : (
            <div className="table-wrap">
              <table className="data-table project-overview-table">
                <thead><tr><th>项目</th><th>状态</th><th>项目联系人</th><th>软件包 / 节点</th><th>待转测</th><th>在测批次</th><th>待发试制</th><th>绑定中</th><th>待转正</th><th>最近活动</th><th aria-label="操作" /></tr></thead>
                <tbody>
                  {projects.map((project) => {
                    const latestBatch = batches.filter((batch) => batch.projectId === project.id)
                      .sort((a, b) => new Date(b.sentAt ?? b.createdAt).getTime() - new Date(a.sentAt ?? a.createdAt).getTime())[0];
                    return (
                      <tr key={project.id} className="project-overview-row">
                        <td>
                          <Link href={`/projects/${project.id}`} className="project-overview-name">{project.name}</Link>
                          <div className="small muted">{project.code} · {project.description}</div>
                        </td>
                        <td><Badge tone={PROJECT_STATUS_META[project.status].tone} dot>{PROJECT_STATUS_META[project.status].label}</Badge></td>
                        <td>
                          <div className="small">PM {project.pmName ?? "待指定"}</div>
                          <div className="small muted">经理 {project.softwareManagerName ?? "待指定"}</div>
                        </td>
                        <td><span className="mono small">{project.packageCount}</span><span className="small muted"> / {project.nodes.length} 节点</span></td>
                        <td><span className="mono small">{pendingByProject.get(project.id) ?? 0}</span></td>
                        <td><span className="mono small">{activeBatchByProject.get(project.id) ?? 0}</span></td>
                        <td><span className="mono small">{readyByProject.get(project.id) ?? 0}</span></td>
                        <td><span className="mono small">{trialByProject.get(project.id) ?? 0}</span></td>
                        <td><span className="mono small">{formalByProject.get(project.id) ?? 0}</span></td>
                        <td className="small muted">{latestBatch ? `${latestBatch.code} · ${formatDateTime(latestBatch.sentAt ?? latestBatch.createdAt)}` : "—"}</td>
                        <td className="cell-actions"><Link href={`/projects/${project.id}`} className="archive-link">进入项目 <ArrowRight size={11} /></Link></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <div className="overview-legend muted-panel" style={{ marginTop: 14 }}>
        <span><Building2 size={13} /> 项目行按项目维度汇总</span>
        <span><Package size={13} /> 软件包数量来自项目使用范围</span>
        <span><Layers3 size={13} /> 在测批次只显示当前进行中的批次</span>
        <span><UsersRound size={13} /> 项目联系人支持多 PM、多软件经理</span>
      </div>
    </>
  );
}
