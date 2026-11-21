import type { Metadata } from "next";
import Link from "next/link";
import { Boxes, ClipboardList } from "lucide-react";
import { canManageProjectWorkflowForProject } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { canCancelVersion, canManageWorkflow } from "@/lib/permissions";
import { getTransferPackageOptions, parseFlash } from "@/lib/queries";
import { requireWorkflowProject } from "@/lib/project-scope";
import { workflowHref } from "@/lib/workflow-links";
import {
  getBatchCandidatesForProject,
  getBatches,
  getPendingTransferGroups,
  getWorkflowProjectScope,
} from "@/lib/workflow-queries";
import { formatDateTime } from "@/lib/format";
import { getRiskTrialEntries } from "@/lib/trial-risk-entry";
import {
  deleteDraftBatchAction,
  sendBatchAction,
} from "@/lib/actions/workflow";
import { ActionForm } from "@/components/action-form";
import { FormDialog } from "@/components/form-dialog";
import { PendingTransferTable } from "@/components/pending-transfer-table";
import { TransferRequestForm } from "@/components/transfer-request-form";
import { Badge, EmptyState, FlashMessage, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "待转测申请" };

function nextBatchCode(batches: Array<{ code: string }>): string {
  const highest = batches.reduce((max, batch) => {
    const match = /^B(\d+)$/i.exec(batch.code);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 120);
  return `B${String(highest + 1).padStart(3, "0")}`;
}

export default async function SubmissionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const notice = parseFlash(params.flash, params.tone === "error" ? "error" : "success");
  const project = requireWorkflowProject(user, params.project);
  const scope = project ? [project.id] : getWorkflowProjectScope(user);
  const groups = getPendingTransferGroups(scope);
  const availablePackages = getTransferPackageOptions(user, project?.id);
  const manager = canManageWorkflow(user);
  const scopedBatches = getBatches(300, scope);
  const allBatches = getBatches(300);
  const draftBatches = manager ? scopedBatches.filter((batch) => batch.status === "DRAFT") : [];
  const defaultCode = nextBatchCode(allBatches);
  const candidatesByProject = new Map(
    manager
      ? groups.filter((group) => canManageProjectWorkflowForProject(user, group.projectId)).map((group, index) => [
          group.projectId,
          { candidates: getBatchCandidatesForProject(group.projectId), code: `B${String(Number(defaultCode.slice(1)) + index).padStart(3, "0")}` },
        ] as const)
      : [],
  );
  const requestCount = groups.reduce((total, group) => total + group.items.length, 0);
  const riskEntries = getRiskTrialEntries(groups.flatMap((group) =>
    candidatesByProject.has(group.projectId) ? group.items.map((item) => item.requestId) : [],
  ));

  const transferDialog = availablePackages.length > 0 ? (
    <FormDialog
      label={<><ClipboardList size={14} /> 提交转测申请</>}
      title="提交转测申请"
      description="选择所属责任田的软件包。提交后会同步发送到该软件包涉及的全部在行项目。"
      triggerClassName="button button-primary"
      testId="submit-transfer-trigger"
      fallbackHref={workflowHref("/submissions/transfer", project?.id)}
    >
      <TransferRequestForm packages={availablePackages} scopeProjectId={project?.id} />
    </FormDialog>
  ) : null;

  return (
    <>
      <PageHeader
        eyebrow="Transfer request / By project"
        title="待转测申请"
        description="转测申请按项目分发。在这里选择本轮软件包、查看待发起批次快照并确认发起。"
        actions={<><Link href={workflowHref("/integration", project?.id)} className="button button-secondary"><Boxes size={14} /> 当前集成测试</Link>{transferDialog}</>}
      />
      <FlashMessage notice={notice} />

      <div className="info-strip" style={{ marginBottom: 16 }}>
        <span><strong>{requestCount}</strong> 个项目转测申请</span>
        <span>覆盖 <strong>{groups.length}</strong> 个项目</span>
        <span><strong>{draftBatches.length}</strong> 个待发起批次</span>
        <span style={{ marginLeft: "auto" }}>同一软件包可继续提交新版本</span>
      </div>

      {manager && draftBatches.length > 0 && (
        <section className="card" style={{ marginBottom: 16 }}>
          <div className="card-header"><div><h2 style={{ fontSize: 18 }}>待发起转测批次</h2><p className="small muted" style={{ marginTop: 3 }}>查看本轮配套快照，确认软件包和版本后发起集成测试。</p></div><Badge tone="amber">{draftBatches.length}</Badge></div>
          <div className="card-body" style={{ padding: 0, marginTop: 12 }}>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>批次</th><th>项目</th><th>配套 / 变更</th><th>创建时间</th><th aria-label="操作" /></tr></thead>
                <tbody>
                  {draftBatches.map((batch) => (
                    <tr key={batch.id}>
                      <td><span className="mono" style={{ fontWeight: 600 }}>{batch.code}</span><div className="small muted">{batch.title}</div></td>
                      <td><span className="chip">{batch.projectName}</span></td>
                      <td><span className="mono small">{batch.itemCount} / {batch.changedCount}</span><div className="small muted">配套 / 变更</div></td>
                      <td className="small muted">{formatDateTime(batch.createdAt)}</td>
                      <td className="cell-actions">
                        <div className="toolbar" style={{ justifyContent: "flex-end", gap: 6, flexWrap: "nowrap" }}>
                          <Link href={workflowHref(`/integration/${batch.id}`, project?.id)} className="button button-secondary button-sm" aria-label={`查看 ${batch.code} 配套`}>查看配套</Link>
                          <ActionForm action={sendBatchAction} hidden={{ batchId: batch.id, scopeProjectId: project?.id }} submitText="发起转测" submitClassName="button-sm" className="inline-action-form" confirmMessage={`确认发起 ${batch.code}？`} />
                          <ActionForm action={deleteDraftBatchAction} hidden={{ batchId: batch.id, scopeProjectId: project?.id }} submitText="删除" submitVariant="ghost" submitClassName="button-sm" className="inline-action-form" confirmMessage="确认删除这个转测草稿？" />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-header"><div><h2 style={{ fontSize: 18 }}>按项目查看申请</h2><p className="small muted" style={{ marginTop: 3 }}>各项目独立安排转测。未选中的软件包申请保留到下轮。</p></div><Badge tone="amber">{groups.length} 个项目</Badge></div>
        <div className="card-body" style={{ paddingTop: 14 }}>
          {groups.length === 0 ? (
            <EmptyState title="没有待转测的申请" description="责任人提交后，申请会按项目出现在这里。" />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {groups.map((group) => (
                <PendingTransferTable
                  key={group.projectId}
                  group={{ ...group, items: group.items.map((item) => ({
                    ...item,
                    canCancel: item.versionStatus === "PENDING_TRANSFER" && canCancelVersion(user, item.submittedById),
                    riskEntry: riskEntries[item.requestId],
                  })) }}
                  scopeProjectId={project?.id}
                  batch={candidatesByProject.get(group.projectId)}
                />
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
