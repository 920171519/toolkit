import { parseDecimalId } from "@/lib/positive-integer";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { canAccessProjectPage } from "@/lib/access";
import { getTransferPackageOptions } from "@/lib/package-queries";
import { getTransferEntryGuidance } from "@/lib/transfer-guidance";
import { requireReadablePackageProject } from "@/lib/project-scope";
import { safeOverviewReturnPath } from "@/lib/return-to";
import { workflowHref } from "@/lib/workflow-links";
import { TransferRequestForm } from "@/components/transfer-request-form";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "提交转测申请" };

export default async function NewTransferRequestPage({ searchParams }: { searchParams: Promise<{ project?: string | string[]; package?: string | string[]; returnTo?: string | string[] }> }) {
  const user = await requireUser();
  const params = await searchParams;
  const project = requireReadablePackageProject(user, params.project);
  const returnTo = safeOverviewReturnPath(params.returnTo);
  const packages = getTransferPackageOptions(user, project?.id);
  if (project && !canAccessProjectPage(user, project.id) && packages.length === 0) notFound();
  const requestedId = parseDecimalId(params.package);
  const initialPackageId = packages.find((pkg) => pkg.id === requestedId)?.id;
  const guidance = !packages.length || (requestedId !== undefined && initialPackageId === undefined)
    ? getTransferEntryGuidance(user, project?.id, requestedId) : [];
  return (
    <>
      <PageHeader
        title="提交转测申请"
        actions={<Link href={workflowHref("/submissions", project?.id, { returnTo })} prefetch={false} className="button button-secondary"><ArrowLeft size={14} />返回转测申请</Link>}
      />
      <section className="card" style={{ maxWidth: 760 }}>
        <div className="card-body">
          {guidance.length > 0 && <section aria-label="转测提交条件" className="risk-callout">
            <h2>{packages.length === 0 ? "没有可提交的软件包" : "指定的软件包暂不可提交"}</h2>
            <ul>{guidance.map((item) => <li key={item.title}>
              <strong>{item.title}</strong>
              {item.detail && <p>{item.detail}</p>}
              {item.href && <Link href={item.href} prefetch={false} className="archive-link">{item.actionLabel}</Link>}
            </li>)}</ul>
          </section>}
          {packages.length > 0 && <TransferRequestForm key={`${project?.id ?? "all"}-${initialPackageId ?? "choose"}`} packages={packages} scopeProjectId={project?.id} initialPackageId={initialPackageId} returnTo={returnTo} />}
        </div>
      </section>
    </>
  );
}
