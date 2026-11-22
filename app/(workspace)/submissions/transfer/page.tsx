import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getTransferPackageOptions } from "@/lib/queries";
import { requireWorkflowProject } from "@/lib/project-scope";
import { safeOverviewReturnPath } from "@/lib/return-to";
import { workflowHref } from "@/lib/workflow-links";
import { TransferRequestForm } from "@/components/transfer-request-form";
import { EmptyState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "提交转测申请" };

export default async function NewTransferRequestPage({ searchParams }: { searchParams: Promise<{ project?: string | string[]; package?: string | string[]; returnTo?: string | string[] }> }) {
  const user = await requireUser();
  const params = await searchParams;
  const project = requireWorkflowProject(user, params.project);
  const returnTo = safeOverviewReturnPath(params.returnTo);
  const packages = getTransferPackageOptions(user, project?.id);
  const requestedId = typeof params.package === "string" ? Number(params.package) : null;
  const initialPackageId = packages.find((pkg) => pkg.id === requestedId)?.id;
  return (
    <>
      <PageHeader
        title="提交转测申请"
        actions={<Link href={workflowHref("/submissions", project?.id, { returnTo })} prefetch={false} className="button button-secondary"><ArrowLeft size={14} />返回转测申请</Link>}
      />
      <section className="card" style={{ maxWidth: 760 }}>
        <div className="card-body">
          {packages.length === 0 ? <EmptyState title="没有可提交的软件包" description="当前范围内没有你所属责任田的启用软件包。" /> : <TransferRequestForm key={`${project?.id ?? "all"}-${initialPackageId ?? "choose"}`} packages={packages} scopeProjectId={project?.id} initialPackageId={initialPackageId} returnTo={returnTo} />}
        </div>
      </section>
    </>
  );
}
