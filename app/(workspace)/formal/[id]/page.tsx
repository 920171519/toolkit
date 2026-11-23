import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { FormDialog } from "@/components/form-dialog";
import { ReleaseFlowEvidence } from "@/components/release-flow-evidence";
import { Badge, ExternalLink, PageHeader, ProgressBar } from "@/components/ui";
import styles from "@/components/workflow-queue.module.css";
import { canAccessProjectPage, canManageProjectWorkflowForProject } from "@/lib/access";
import { releaseFormalAction } from "@/lib/actions/workflow";
import { requireUser } from "@/lib/auth";
import { CONCLUSION_META, type BatchConclusion } from "@/lib/constants";
import { formatDateTime } from "@/lib/format";
import { releaseFlowUrl } from "@/lib/release-flow";
import { requireWorkflowProject } from "@/lib/project-scope";
import { workflowHref } from "@/lib/workflow-links";
import { getWorkflowListState } from "@/lib/workflow-list";
import { getPendingFormalVersions, getTrialDetail, getVersionRequestIds, getWorkflowProjectScope } from "@/lib/workflow-queries";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "转正核对" };

export default async function FormalDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const versionId = Number(id);
  if (!Number.isSafeInteger(versionId) || versionId < 1) notFound();
  const search = await searchParams;
  const project = requireWorkflowProject(user, search.project);
  const scope = project ? [project.id] : getWorkflowProjectScope(user);
  const records = getPendingFormalVersions(scope, versionId);
  if (records.length === 0) notFound();
  const manageable = records.find((record) => canManageProjectWorkflowForProject(user, record.projectId));
  const version = manageable ?? records[0];
  const evidence = getVersionRequestIds(version.versionId)
    .map((requestId) => getTrialDetail(requestId))
    .filter((detail): detail is NonNullable<ReturnType<typeof getTrialDetail>> => detail !== null);
  const projects = evidence.map(({ request }) => request.projectName);
  const returnHref = workflowHref("/formal", project?.id, getWorkflowListState(search));
  const traceHref = workflowHref(`/versions/${version.versionId}`, project?.id);

  return (
    <>
      <PageHeader
        title={`${version.packageName} ${version.version} · 转正核对`}
        actions={<>
          <Link href={returnHref} prefetch={false} className="button button-secondary"><ArrowLeft size={14} aria-hidden="true" />返回待转正列表</Link>
          {manageable && <FormDialog label="发布正式版本" title={`转正 ${version.packageName} ${version.version}`} description={`${projects.join("、")} 将同步使用该正式版本。`} cancelLabel="取消">
            <ActionForm action={releaseFormalAction} hidden={{ requestId: manageable.requestId, scopeProjectId: project?.id, ...getWorkflowListState(search) }} submitText="提交转正电子流并发布">
              <label className="field">
                <span className="label">转正电子流网址 <span className="required-mark" aria-hidden="true">*</span></span>
                <input className="input" name="flowNo" type="url" required placeholder="https://eflow.example.com/releases/152" />
              </label>
            </ActionForm>
          </FormDialog>}
        </>}
      />
      <div className={styles.detailColumns}>
        <section className="card" aria-label="项目验收与绑定证据">
          <div className="card-header"><h2 className={styles.tableHeading}>验收与绑定证据</h2><Badge tone="emerald" dot>{manageable ? "待转正" : "待软件经理发布"}</Badge></div>
          <div className="card-body">
            <div className={styles.nodeList}>
              {evidence.map(({ request, requirements }, index) => {
                const conclusion = request.batchConclusion ? CONCLUSION_META[request.batchConclusion as BatchConclusion] : null;
                const passed = requirements.filter((requirement) => requirement.status === "PASSED").length;
                const waived = requirements.filter((requirement) => requirement.waivedAt).length;
                const canInspect = canAccessProjectPage(user, request.projectId);
                const trialUrl = releaseFlowUrl(request.trialFormNo);
                return <details className="binding-table-item" key={request.id} open={project ? request.projectId === project.id : index === 0}>
                  <summary className={styles.nodeHeading}>
                    <span><strong>{request.projectName}</strong><span className="small muted">{trialUrl ? "已登记试制电子流" : request.trialFormNo ?? "无试制电子流"}</span></span>
                    {request.bindingMode === "SKIPPED" ? <Badge tone="slate">无需绑定</Badge> : <Badge tone="teal">{passed + waived}/{requirements.length} 节点已完成</Badge>}
                    <ChevronDown size={16} aria-hidden="true" />
                  </summary>
                  <div className="binding-table-body">
                    <div className={styles.rowActions}>
                      {trialUrl && <ReleaseFlowEvidence value={trialUrl} label="查看试制电子流" />}
                      {request.releaseMode === "RISK" && <Badge tone="amber">风险发布</Badge>}
                      {request.batchId && (canInspect
                        ? <Link href={workflowHref(`/integration/${request.batchId}`, request.projectId)} prefetch={false} className="archive-link">转测批次 {request.batchCode} · {conclusion?.label ?? "已提交"}</Link>
                        : <span className="small muted">转测批次 {request.batchCode} · {conclusion?.label ?? "已提交"}</span>)}
                      {!request.batchId && <span className="small muted">无关联转测批次</span>}
                      {canInspect && <Link href={workflowHref(`/trial/${request.id}`, request.projectId)} prefetch={false} className="archive-link">查看绑定验证记录</Link>}
                    </div>
                    {request.riskConclusion && <p className="note">风险结论：{request.riskConclusion}</p>}
                    {request.bindingMode === "SKIPPED"
                      ? <p className="note">无需绑定原因：{request.bindingReason ?? "—"}</p>
                      : <>
                        <ProgressBar value={passed + waived} max={requirements.length || 1} />
                        {requirements.map((requirement) => (
                          <div className="formal-requirement" key={requirement.id}>
                            <div className={styles.rowActions}>
                              <strong>{requirement.nodeName}</strong>
                              <Badge tone={requirement.status === "PASSED" ? "emerald" : requirement.status === "CANCELLED" ? "slate" : "amber"}>{requirement.status === "PASSED" ? "节点通过" : requirement.waivedAt ? "节点免绑定" : requirement.status === "CANCELLED" ? "无需绑定" : "待通过"}</Badge>
                              <span className="small muted">通过条码 {requirement.approvedCount}/{requirement.requiredCount}</span>
                            </div>
                            {requirement.waivedAt && <p className="small muted">免绑原因：{requirement.decisionReason} · {requirement.waivedByName ?? "—"} · {formatDateTime(requirement.waivedAt)}</p>}
                            {requirement.flows.filter((flow) => flow.status === "APPROVED").map((flow) => (
                              <div className="formal-flow-line" key={flow.id}><span className="mono small">{flow.flowNo}</span><span className="small">{flow.barcodes.length} 个条码：{flow.barcodes.join("、")}</span>{flow.webUrl && <ExternalLink href={flow.webUrl}>网页电子流</ExternalLink>}</div>
                            ))}
                          </div>
                        ))}
                      </>}
                  </div>
                </details>;
              })}
            </div>
          </div>
        </section>
        <aside className="card" aria-label="版本资料">
          <div className="card-header"><h2 className={styles.tableHeading}>版本资料</h2></div>
          <div className="card-body">
            <p className="change-copy">{version.changeSummary}</p>
            <p className="note">试制发布于 {formatDateTime(version.trialReleasedAt)}</p>
            <div className={styles.rowActions}><ExternalLink href={version.archiveUrl}>归档包</ExternalLink><Link href={traceHref} prefetch={false} className="archive-link">版本全链路</Link></div>
          </div>
        </aside>
      </div>
    </>
  );
}
