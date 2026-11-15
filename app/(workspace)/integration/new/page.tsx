import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, FolderKanban } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { getBatchCandidatesForProject, getBatches, getManagedProjectIds, getProjectOptions } from "@/lib/workflow-queries";
import { BatchBuilder } from "@/components/batch-builder";
import { EmptyState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "组织项目转测" };

function nextBatchCode(): string {
  const batches = getBatches(200);
  const highest = batches.reduce((max, batch) => {
    const match = /^B(\d+)$/i.exec(batch.code);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 120);
  return `B${String(highest + 1).padStart(3, "0")}`;
}

export default async function NewBatchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireRole(["ADMIN", "SOFTWARE_MANAGER"]);
  const params = await searchParams;
  const projectParam = Array.isArray(params.project) ? params.project[0] : params.project;
  const managedIds = user.role === "ADMIN" ? null : new Set(getManagedProjectIds(user));
  const projects = getProjectOptions().filter((project) => managedIds === null || managedIds.has(project.id));
  const selectedProject = projects.find((project) => project.id === Number(projectParam));
  const candidates = selectedProject ? getBatchCandidatesForProject(selectedProject.id) : [];
  const activeCount = selectedProject
    ? getBatches(100).filter((batch) => batch.status === "IN_TEST" && batch.projectId === selectedProject.id).length
    : 0;

  return (
    <>
      <PageHeader
        eyebrow="Integration / Create bundle"
        title={selectedProject ? `为 ${selectedProject.name} 组织转测` : "组织项目转测"}
        description="集成测试以本项目为单位组织，每轮转测必须包含本项目全部软件包配套。不同项目可同时创建批次。"
        actions={<Link href="/integration" className="button button-secondary"><ArrowLeft size={14} />返回批次列表</Link>}
      />

      {!selectedProject ? (
        <section className="card">
          <div className="card-body">
            <div className="toolbar" style={{ gap: 8, marginBottom: 14 }}>
              <FolderKanban size={17} style={{ color: "var(--brand)" }} />
              <h2 style={{ fontSize: 17 }}>先选择项目</h2>
            </div>
            {projects.length === 0 ? (
              <EmptyState title="没有可测试的在行项目" description="请先在项目配置中创建并启用项目。" />
            ) : (
              <form method="get" action="/integration/new" className="toolbar">
                <label className="field" style={{ minWidth: 280 }}>
                  <span className="label">项目</span>
                  <select className="select" name="project" required defaultValue="">
                    <option value="" disabled>选择项目</option>
                    {projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
                  </select>
                </label>
                <button type="submit" className="button button-primary" style={{ alignSelf: "flex-end" }}>进入配套清单</button>
              </form>
            )}
            <div className="muted-panel" style={{ marginTop: 16 }}>集成测试按项目运作，不同项目拥有不同的软件包配套和测试安排。</div>
          </div>
        </section>
      ) : (
        <>
          <div className="toolbar-spread" style={{ marginBottom: 14 }}>
            <div className="toolbar" style={{ gap: 8 }}>
              <span className="chip">{selectedProject.code}</span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{selectedProject.name}</span>
              <span className="small muted">{activeCount} 个该项目的批次正在测试</span>
            </div>
            <form method="get" action="/integration/new" className="toolbar">
              <select className="select" name="project" defaultValue={selectedProject.id} style={{ minHeight: 34, width: 180, fontSize: 12 }}>
                {projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
              </select>
              <button type="submit" className="button button-secondary button-sm">切换项目</button>
            </form>
          </div>
          <div className="card">
            <div className="card-body">
              <BatchBuilder
                project={selectedProject}
                candidates={candidates}
                defaultCode={nextBatchCode()}
              />
            </div>
          </div>
          <p className="page-footnote">创建后仅生成待发起草稿；确认整套快照后发起转测。本项目可同时存在多个测试批次。</p>
        </>
      )}
    </>
  );
}
