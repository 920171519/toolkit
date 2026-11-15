import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Boxes, LayoutGrid } from "lucide-react";
import { requireUser } from "@/lib/auth";
import {
  getPackageOverviewRows,
  getPeople,
  parseFlash,
} from "@/lib/queries";
import { PackageOverviewTable } from "@/components/package-overview-table";
import { getProjectOptions } from "@/lib/workflow-queries";
import { FlashMessage, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "软件版本总览" };

export default async function PackagesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const params = await searchParams;
  const notice = parseFlash(params.flash, params.tone === "error" ? "error" : "success");
  const projects = getProjectOptions();
  const projectParam = Array.isArray(params.project) ? params.project[0] : params.project;
  const selectedProject = projects.find((project) => project.id === Number(projectParam));
  const packages = getPackageOverviewRows(selectedProject?.id);
  const people = getPeople();
  const openIdParam = Array.isArray(params.open) ? params.open[0] : params.open;
  const initialOpenId = openIdParam && Number.isInteger(Number(openIdParam)) ? Number(openIdParam) : undefined;
  const withFormal = packages.filter((pkg) => pkg.formalVersion).length;
  const inFlight = packages.filter((pkg) => pkg.currentVersion).length;
  const inTrial = packages.filter((pkg) => pkg.trialVersions.length > 0).length;

  return (
    <>
      <PageHeader
        eyebrow="Software packages / Version overview"
        title="软件版本总览"
        description="可按项目查看软件包版本。使用范围只展示在行项目，已归档项目只在项目视图的存档项目中查看。"
        actions={
          <>
            <Link href="/projects" className="button button-secondary">
              <LayoutGrid size={14} /> 按项目查看
            </Link>
            <Link href="/submissions" className="button button-primary">
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
                  {projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
                </select>
              </label>
              <button type="submit" className="button button-secondary button-sm">切换</button>
            </div>
            <span className="small muted">按项目查看时，版本状态、试制版本与在途版本均以该项目为准；已结束项目不在本页展示。</span>
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
          <Link href="/integration" className="archive-link">
            查看在测配套 <ArrowRight size={11} />
          </Link>
        </span>
      </div>

      <PackageOverviewTable
        packages={packages}
        people={people}
        initialOpenId={initialOpenId}
        scopeLabel={selectedProject?.name ?? "全部在行项目"}
      />
    </>
  );
}
