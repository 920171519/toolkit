import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getTransferPackageOptions } from "@/lib/queries";
import { requireWorkflowProject } from "@/lib/project-scope";
import { workflowHref } from "@/lib/workflow-links";
import { TransferRequestForm } from "@/components/transfer-request-form";
import { EmptyState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "提交转测申请" };

export default async function NewTransferRequestPage({ searchParams }: { searchParams: Promise<{ project?: string | string[] }> }) {
  const user = await requireUser();
  const project = requireWorkflowProject(user, (await searchParams).project);
  const packages = getTransferPackageOptions(user, project?.id);
  return (
    <>
      <PageHeader
        eyebrow="Transfer request"
        title="提交转测申请"
        description="提交后会同步发送到该软件包涉及的全部在行项目；五项信息均为必填。"
        actions={<Link href={workflowHref("/submissions", project?.id)} className="button button-secondary"><ArrowLeft size={14} />返回待转测申请</Link>}
      />
      <section className="card" style={{ maxWidth: 760 }}>
        <div className="card-body">
          {packages.length === 0 ? <EmptyState title="没有可提交的软件包" description="当前范围内没有你所属责任田的启用软件包。" /> : <TransferRequestForm packages={packages} scopeProjectId={project?.id} />}
        </div>
      </section>
    </>
  );
}
