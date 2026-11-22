import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { BatchBuilder } from "@/components/batch-builder";
import { EmptyState, PageHeader } from "@/components/ui";
import { canManageProjectWorkflowForProject } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { batchSelectionKey } from "@/lib/batch-preparation";
import { requireWorkflowProject } from "@/lib/project-scope";
import { workflowHref } from "@/lib/workflow-links";
import { getWorkflowListState } from "@/lib/workflow-list";
import { getBatchCandidatesForProject, getNextBatchCode } from "@/lib/workflow-queries";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "新建转测批次" };

export default async function NewTransferBatchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const search = await searchParams;
  const project = requireWorkflowProject(user, search.project);
  if (!project || project.status === "ARCHIVED" || !canManageProjectWorkflowForProject(user, project.id)) notFound();
  const candidates = getBatchCandidatesForProject(project.id);
  const canCreate = candidates.some((candidate) => candidate.versions.some((version) => version.requestStatus === "PENDING"));
  const listState = getWorkflowListState(search);
  const returnTo = workflowHref("/submissions", search.from === "all" ? undefined : project.id, listState);

  return (
    <>
      <PageHeader
        title="新建转测批次"
        actions={<Link href={returnTo} prefetch={false} className="button button-secondary"><ArrowLeft size={14} />返回转测申请</Link>}
      />
      <section className="card" aria-label="转测批次配置">
        <div className="card-body">
          {canCreate
            ? <BatchBuilder project={project} candidates={candidates} defaultCode={getNextBatchCode()} scopeProjectId={project.id} selectionKey={batchSelectionKey(user.id, project.id)} returnTo={listState.returnTo} />
            : <EmptyState title="当前没有可安排的转测申请" />}
        </div>
      </section>
    </>
  );
}
