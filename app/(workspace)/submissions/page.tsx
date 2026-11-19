import type { Metadata } from "next";
import Link from "next/link";
import { Boxes, ClipboardList, Link2, UserRound } from "lucide-react";
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
import {
  cancelTransferAction,
  deleteDraftBatchAction,
  sendBatchAction,
} from "@/lib/actions/workflow";
import { ActionForm } from "@/components/action-form";
import { BatchBuilder } from "@/components/batch-builder";
import { FormDialog } from "@/components/form-dialog";
import { TransferRequestForm } from "@/components/transfer-request-form";
import { Badge, EmptyState, ExternalLink, FlashMessage, PageHeader } from "@/components/ui";

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
      ? groups.map((group, index) => [
          group.projectId,
          { candidates: getBatchCandidatesForProject(group.projectId), code: `B${String(Number(defaultCode.slice(1)) + index).padStart(3, "0")}` },
        ])
      : [],
  );
  const requestCount = groups.reduce((total, group) => total + group.items.length, 0);

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
                        <div className="toolbar" style={{ justifyContent: "flex-end", gap: 6 }}>
                          <Link href={workflowHref(`/integration/${batch.id}`, project?.id)} className="button button-secondary button-sm" aria-label={`查看 ${batch.code} 配套`}>查看配套</Link>
                          <ActionForm action={sendBatchAction} hidden={{ batchId: batch.id, scopeProjectId: project?.id }} submitText="发起转测" submitClassName="button-sm" confirmMessage={`确认发起 ${batch.code}？`} />
                          <ActionForm action={deleteDraftBatchAction} hidden={{ batchId: batch.id, scopeProjectId: project?.id }} submitText="删除" submitVariant="ghost" submitClassName="button-sm" confirmMessage="确认删除这个转测草稿？" />
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
              {groups.map((group) => {
                const setup = candidatesByProject.get(group.projectId);
                return (
                  <section key={group.projectId} className="project-request-group">
                    <div className="split-row">
                      <div className="toolbar" style={{ gap: 8 }}><span className="chip">{group.projectCode}</span><span style={{ fontSize: 14, fontWeight: 600 }}>{group.projectName}</span><Badge tone="amber">{group.items.length} 个申请</Badge></div>
                      {manager && setup && (
                        <FormDialog label="整套发起转测" title={`${group.projectName} · 整套配套转测`} description="按项目配套选择本轮软件包。版本默认沿用上次转测，有待转测申请时优先选择新版本。" triggerClassName="button button-secondary button-sm" testId={`open-batch-${group.projectId}`} wide>
                          {setup.candidates.length > 0 ? (
                            <BatchBuilder project={{ id: group.projectId, name: group.projectName, code: group.projectCode, status: "ACTIVE" }} candidates={setup.candidates} defaultCode={setup.code} scopeProjectId={project?.id} />
                          ) : <div className="muted-panel">本项目当前没有可组织转测的软件包版本。</div>}
                        </FormDialog>
                      )}
                    </div>
                    <div className="version-list">
                      {group.items.map((item) => (
                        <article key={`${group.projectId}-${item.requestId}`} className="version-row" style={{ alignItems: "flex-start", padding: "13px 0" }}>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div className="toolbar" style={{ gap: 8 }}>
                              <Link prefetch={false} href={workflowHref("/packages", project?.id, { open: item.packageId })} style={{ fontWeight: 600, fontSize: 14 }}>{item.packageName}</Link>
                              <span className="version-badge">{item.version}</span>
                              <Badge tone="amber" dot>待集成测试</Badge>
                            </div>
                            <p className="change-copy" style={{ marginTop: 6 }}>{item.changeSummary}</p>
                            <div className="toolbar" style={{ gap: 16, marginTop: 7, fontSize: 11, color: "var(--muted)" }}>
                              <span className="toolbar" style={{ gap: 5 }}><UserRound size={12} /> {item.submittedByName ?? "未知申请人"} · {formatDateTime(item.submittedAt)}</span>
                              <span className="toolbar" style={{ gap: 5 }}><Link2 size={12} /><ExternalLink href={item.archiveUrl}>包归档</ExternalLink></span>
                              <span>责任人 {item.ownerName ?? "未指定"}</span>
                            </div>
                          </div>
                          {item.versionStatus === "PENDING_TRANSFER" && canCancelVersion(user, item.submittedById) && (
                            <ActionForm action={cancelTransferAction} hidden={{ versionId: item.versionId, scopeProjectId: project?.id }} submitText="撤回申请" submitVariant="outline-danger" submitClassName="button-sm" confirmMessage={`撤回将同时撤销 ${item.packageName} ${item.version} 在所有项目的转测申请，确认继续？`} className="inline-action-form" />
                          )}
                        </article>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
