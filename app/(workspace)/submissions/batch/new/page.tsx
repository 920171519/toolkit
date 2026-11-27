import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { BatchBuilder } from "@/components/batch-builder";
import { EmptyState, PageHeader } from "@/components/ui";
import { canManageProjectWorkflowForProject } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { batchSelectionKey, draftRequestListState, readTransferRequestId } from "@/lib/batch-preparation";
import { requireWorkflowProject } from "@/lib/project-scope";
import { workflowHref } from "@/lib/workflow-links";
import { getWorkflowListState } from "@/lib/workflow-list";
import { getBatchCandidatesForProject, getBatchCount, getBatchDetail, getNextBatchCode } from "@/lib/batch-queries";
import { getBatchSendCheck } from "@/lib/batch-send-check";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "新建转测批次" };

export default async function NewTransferBatchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const search = await searchParams;
  const project = requireWorkflowProject(user, search.project);
  if (!project || project.status === "ARCHIVED" || !canManageProjectWorkflowForProject(user, project.id)) notFound();
  const draftId = typeof search.draft === "string" && /^[1-9][0-9]*$/.test(search.draft) ? Number(search.draft) : undefined;
  const draft = draftId && Number.isSafeInteger(draftId) ? getBatchDetail(user, draftId, project.id) : null;
  const listState = getWorkflowListState(search);
  const draftListState = { ...listState, ...draftRequestListState(search) };
  const returnScope = search.from === "all" ? undefined : project.id;
  const draftsHref = workflowHref("/submissions", returnScope, { ...listState, view: "drafts" });
  if (draft && draft.batch.status !== "DRAFT") {
    redirect(workflowHref(`/integration/${draft.batch.id}`, returnScope, listState));
  }
  if (search.draft !== undefined && !draft) {
    return <>
      <PageHeader title="草稿当前不可用" />
      <section className="card">
        <EmptyState title="当前项目没有此草稿"
          action={<Link href={draftsHref} prefetch={false} className="button button-secondary">查看待发起批次</Link>} />
      </section>
    </>;
  }
  const candidates = getBatchCandidatesForProject(project.id, draft?.batch.id);
  const canCreate = candidates.some((candidate) => candidate.versions.some((version) => version.requestStatus === "PENDING" && version.status !== "VOID"));
  const hasDrafts = !canCreate && !draft && getBatchCount([project.id], { statuses: ["DRAFT"], activeProjectsOnly: true }) > 0;
  const transfersHref = workflowHref("/submissions", draft ? project.id : returnScope, draft ? { returnTo: listState.returnTo }
    : { ...listState, request: readTransferRequestId(search.request) });
  const returnHref = draft ? workflowHref(`/integration/${draft.batch.id}`, returnScope, draftListState)
    : transfersHref;
  const draftIssues = draft ? getBatchSendCheck(draft.batch.id).blockers : [];

  return (
    <>
      <PageHeader
        title={draft ? `调整 ${draft.batch.code} 配套` : "新建转测批次"}
        actions={<Link href={returnHref} prefetch={false} className="button button-secondary"><ArrowLeft size={14} />{draft ? "返回批次草稿" : "返回转测申请"}</Link>}
      />
      <section className="card" aria-label="转测批次配置">
        <div className="card-body">
          {draftIssues.length > 0 && <ul className="risk-callout">{draftIssues.map((item) => <li key={item.message}>{item.message}</li>)}</ul>}
          {canCreate || draft
            ? <BatchBuilder project={project} candidates={candidates} defaultCode={draft?.batch.code ?? getNextBatchCode()} scopeProjectId={draft ? returnScope : project.id}
                selectionKey={draft ? undefined : batchSelectionKey(user.id, project.id)} returnTo={listState.returnTo}
                draft={draft ? { id: draft.batch.id, title: draft.batch.title, revision: draft.items.reduce((revision, item) => Math.max(revision, item.id), 0),
                  items: draft.items.map(({ packageId, versionId, isChanged }) => ({ packageId, versionId, isChanged })) } : undefined}
                listState={draft ? draftListState : undefined} transfersHref={transfersHref} />
            : <EmptyState title="当前没有可安排的转测申请"
              description={hasDrafts ? "可在待发起批次中检查既有配套。" : "需要先提交本项目使用的软件包版本。"}
              action={<Link href={hasDrafts ? workflowHref("/submissions", project.id, { view: "drafts", returnTo: listState.returnTo })
                : workflowHref("/submissions/transfer", project.id, { returnTo: listState.returnTo })}
                prefetch={false} className="button button-secondary button-sm">{hasDrafts ? "查看待发起批次" : "查看转测提交条件"}</Link>} />}
        </div>
      </section>
    </>
  );
}
