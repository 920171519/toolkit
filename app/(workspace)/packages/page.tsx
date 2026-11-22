import type { Metadata } from "next";
import Link from "next/link";
import { ListTree, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth";
import {
  getPackageDetail,
  getPackageOverviewRows,
  getPeople,
  getTransferPackageOptions,
  parseFlash,
} from "@/lib/queries";
import { canEditPackageById, hasAreaLeadership } from "@/lib/access";
import { PackageOverviewTable } from "@/components/package-overview-table";
import { InfoTooltip } from "@/components/info-tooltip";
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
  const people = user.role === "ADMIN" || hasAreaLeadership(user.id) ? getPeople() : [];
  const openIdParam = Array.isArray(params.open) ? params.open[0] : params.open;
  const initialOpenId = openIdParam && Number.isInteger(Number(openIdParam)) ? Number(openIdParam) : undefined;
  const initialDetail = initialOpenId ? getPackageDetail(initialOpenId, true, selectedProject?.id) : null;
  const initialCanEdit = initialOpenId ? canEditPackageById(user, initialOpenId) : false;
  const transferableIds = getTransferPackageOptions(user, selectedProject?.id).map((pkg) => pkg.id);

  return (
    <>
      <PageHeader
        title="软件版本总览"
        help={selectedProject && <InfoTooltip label="软件包使用范围说明">按项目筛选后，使用范围仍列出每个软件包的全部在行项目和节点。</InfoTooltip>}
        actions={
          <>
            <Link href={workflowHref("/versions", selectedProject?.id)} className="button button-secondary">
              <ListTree size={14} aria-hidden="true" /> 版本全链路
            </Link>
            {transferableIds.length > 0 && <Link href={workflowHref("/submissions/transfer", selectedProject?.id)} className="button button-primary"><Plus size={14} aria-hidden="true" /> 提交转测申请</Link>}
          </>
        }
      />
      <FlashMessage notice={notice} />

      <PackageOverviewTable
        key={selectedProject?.id ?? "all"}
        packages={packages}
        people={people}
        transferableIds={transferableIds}
        selectedProjectId={selectedProject?.id}
        initialDetail={initialDetail ? { ...initialDetail, canEdit: initialCanEdit } : null}
      />
    </>
  );
}
