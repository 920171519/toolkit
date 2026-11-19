import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Boxes, LayoutGrid, ListTree } from "lucide-react";
import { requireUser } from "@/lib/auth";
import {
  getPackageDetail,
  getPackageOverviewRows,
  getPeople,
  parseFlash,
} from "@/lib/queries";
import { canEditPackageById } from "@/lib/access";
import { PackageOverviewTable } from "@/components/package-overview-table";
import { getWorkflowProjectOptions, requireWorkflowProject } from "@/lib/project-scope";
import { workflowHref } from "@/lib/workflow-links";
import { FlashMessage, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "软件版本总览" };

export default async function PackagesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const notice = parseFlash(params.flash, params.tone === "error" ? "error" : "success");
  const selectedProject = requireWorkflowProject(user, params.project);
  const projects = getWorkflowProjectOptions(user);
  const packages = getPackageOverviewRows(selectedProject?.id);
  const people = getPeople();
  const openIdParam = Array.isArray(params.open) ? params.open[0] : params.open;
  const initialOpenId = openIdParam && Number.isInteger(Number(openIdParam)) ? Number(openIdParam) : undefined;
  const initialDetail = initialOpenId ? getPackageDetail(initialOpenId, true, selectedProject?.id) : null;
  const initialCanEdit = initialOpenId ? canEditPackageById(user, initialOpenId) : false;
  const withFormal = packages.filter((pkg) => pkg.formalVersion).length;
  const inFlight = packages.filter((pkg) => pkg.currentVersion).length;
  const inTrial = packages.filter((pkg) => pkg.trialVersions.length > 0).length;

  return (
    <>
      <PageHeader
        eyebrow="Software packages / Version overview"
        title="软件版本总览"
        description={selectedProject
          ? `${selectedProject.name} · 查看本项目软件包的正式、试制和在途版本，以及各软件包在全部在行项目中的使用范围。`
          : "按项目查看软件包及其版本，使用范围展示该软件包在全部在行项目中的节点覆盖。"}
        actions={
          <>
            <Link href={selectedProject ? `/projects/${selectedProject.id}` : "/overview"} className="button button-secondary">
              <LayoutGrid size={14} /> {selectedProject ? "项目工作区" : "按项目查看"}
            </Link>
            <Link href={workflowHref("/versions", selectedProject?.id)} className="button button-secondary">
              <ListTree size={14} /> 版本全链路
            </Link>
            <Link href={workflowHref("/submissions", selectedProject?.id)} className="button button-primary">
              <Boxes size={14} /> 提交转测申请
            </Link>
          </>
        }
      />
      <FlashMessage notice={notice} />

      <section className="card" style={{ marginBottom: 14 }}>
        <div className="card-body" style={{ padding: "12px 15px" }}>
          <form method="get" action="/packages" className="toolbar-spread" style={{ alignItems: "flex-end" }}>
            <div className="toolbar" style={{ alignItems: "flex-end", gap: 10 }}>
              <label className="field" style={{ minWidth: 240 }}>
                <span className="label">查看范围</span>
                <select className="select" name="project" defaultValue={selectedProject?.id ?? ""}>
                  <option value="">全部在行项目</option>
                  {(selectedProject?.status === "ARCHIVED" ? [...projects, selectedProject] : projects).map((project) =>
                    <option value={project.id} key={project.id}>{project.name}</option>,
                  )}
                </select>
              </label>
              <button type="submit" className="button button-secondary button-sm">切换</button>
            </div>
            <span className="small muted">按项目筛选只限制软件包列表；使用范围列始终展示全部在行项目，已结束项目不在本页展示。</span>
          </form>
        </div>
      </section>

      <div className="info-strip" style={{ marginBottom: 18 }}>
        <span>
          软件包总数 <strong>{packages.length}</strong>
        </span>
        <span>
          当前范围 <strong>{selectedProject?.name ?? "全部在行项目"}</strong>
        </span>
        <span>
          已有正式版本 <strong>{withFormal}</strong>
        </span>
        <span>
          试制 / 待转正 <strong>{inTrial}</strong>
        </span>
        <span>
          存在在途版本 <strong>{inFlight}</strong>
        </span>
        <span style={{ marginLeft: "auto" }}>
          <Link href={workflowHref("/integration", selectedProject?.id)} className="archive-link">
            查看在测配套 <ArrowRight size={11} />
          </Link>
        </span>
      </div>

      <PackageOverviewTable
        key={`${selectedProject?.id ?? "all"}-${initialOpenId ?? "closed"}`}
        packages={packages}
        people={people}
        initialOpenId={initialOpenId}
        scopeLabel={selectedProject?.name ?? "全部在行项目"}
        selectedProjectId={selectedProject?.id}
        initialDetail={initialDetail ? { ...initialDetail, canEdit: initialCanEdit } : null}
      />
    </>
  );
}
