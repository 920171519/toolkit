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
import { requireWorkflowProject } from "@/lib/project-scope";
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
        key={selectedProject?.id ?? "all"}
        packages={packages}
        people={people}
        scopeLabel={selectedProject?.name ?? "全部在行项目"}
        selectedProjectId={selectedProject?.id}
        initialDetail={initialDetail ? { ...initialDetail, canEdit: initialCanEdit } : null}
      />
    </>
  );
}
