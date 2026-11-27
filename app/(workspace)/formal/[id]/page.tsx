import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { BindingBarcodeList } from "@/components/binding-barcode-list";
import { FormDialog } from "@/components/form-dialog";
import { GuidanceDialog } from "@/components/guidance-dialog";
import { ReleaseFlowEvidence } from "@/components/release-flow-evidence";
import { VersionVoidDialog } from "@/components/version-void-dialog";
import { WorkflowPackageName } from "@/components/workflow-package-name";
import { Badge, ExternalLink, FlashMessage, PageHeader, ProgressBar } from "@/components/ui";
import styles from "@/components/workflow-queue.module.css";
import { canAccessProjectPage, canManageProjectWorkflowForProject, getProjectWorkflowProjectIds } from "@/lib/access";
import { releaseFormalAction } from "@/lib/actions/workflow";
import { requireUser } from "@/lib/auth";
import { CONCLUSION_META, type BatchConclusion } from "@/lib/constants";
import { all } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { packageIdentity } from "@/lib/package-identity";
import { parseFlash } from "@/lib/queries";
import { releaseFlowUrl } from "@/lib/release-flow";
import { requireWorkflowProject } from "@/lib/project-scope";
import { workflowHref } from "@/lib/workflow-links";
import { getWorkflowListState } from "@/lib/workflow-list";
import { getPendingBindingFlowCount, getPendingFormalVersions, getTrialDetail, getVersionRequestIds } from "@/lib/workflow-queries";
import { getFormalReleaseGuidance } from "@/lib/release-guidance";

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
  const notice = parseFlash(search.flash, search.tone === "error" ? "error" : "success");
  const project = requireWorkflowProject(user, search.project);
  const scope = project ? [project.id] : getProjectWorkflowProjectIds(user);
  const listState = getWorkflowListState(search);
  const guidance = getFormalReleaseGuidance(user, versionId, { projectId: project?.id, returnTo: listState.returnTo });
  const returnHref = workflowHref("/formal", project?.id, listState);
  const traceHref = workflowHref(`/versions/${versionId}`, project?.id, { ...listState, from: "formal" });
  const records = getPendingFormalVersions(scope, versionId);
  if (records.length === 0) {
    // A version can leave the live queue when its last project is archived.
    const canViewHistory = !guidance && all<{ projectId: number }>(
      `SELECT project_id AS projectId
       FROM version_transfer_requests WHERE package_version_id = ? AND trial_released_at IS NOT NULL`, versionId,
    ).some(({ projectId }) => (project === undefined || project.id === projectId) && canAccessProjectPage(user, projectId));
    if (!guidance && !canViewHistory) notFound();
    const title = guidance?.status === "FORMAL" ? "该版本已转正"
      : guidance?.status === "VOID" ? "该版本已作废" : "该版本暂未入列";
    return (
      <>
        <PageHeader title="转正核对" description={guidance?.description}
          actions={<Link href={returnHref} prefetch={false} className="button button-secondary"><ArrowLeft size={14} aria-hidden="true" />返回待转正列表</Link>} />
        <FlashMessage notice={notice} />
        <section className={styles.nextAction}>
          <h2>{title}</h2>
          {guidance && guidance.status !== "FORMAL" && guidance.status !== "VOID"
            ? <GuidanceDialog label="查看转正条件" title="转正发布条件" description={guidance.description} items={guidance.items} />
            : <Link href={traceHref} prefetch={false} className="button button-secondary">查看版本记录</Link>}
        </section>
      </>
    );
  }
  const manageable = records.find((record) => canManageProjectWorkflowForProject(user, record.projectId));
  const version = manageable ?? records[0];
  const pendingBindingFlows = guidance?.pendingFlowCount ?? getPendingBindingFlowCount(versionId);
  const identity = packageIdentity({ name: version.packageName, code: version.packageCode });
  const evidence = getVersionRequestIds(version.versionId)
    .map((requestId) => getTrialDetail(requestId))
    .filter((detail): detail is NonNullable<ReturnType<typeof getTrialDetail>> => detail !== null);
  const projects = evidence.map(({ request }) => request.projectName);
  const trialReviewMinutes = evidence[0]?.request.trialReviewMinutes;
  const canPublish = Boolean(manageable && guidance?.href);
  const publishGuidance = guidance?.items.length ? guidance.items : [{
    title: "请从具有管理权限的项目核对发布",
    detail: "该版本由任一在行使用项目的软件经理或管理员发布。",
    href: guidance?.href ?? traceHref,
    actionLabel: guidance?.href ? "前往转正发布" : "查看版本全链路",
  }];

  return (
    <>
      <PageHeader
        title={`${identity.code} ${version.version} · 转正核对`}
        description={identity.name !== identity.code ? identity.name : undefined}
        actions={<>
          <Link href={returnHref} prefetch={false} className="button button-secondary"><ArrowLeft size={14} aria-hidden="true" />返回待转正列表</Link>
          {manageable && <VersionVoidDialog versionId={versionId} code={identity.code} version={version.version}
            returnFields={{ ...listState, scopeProjectId: project?.id, from: "formal" }} />}
          {canPublish && manageable ? <FormDialog label="发布正式版本" title={`转正 ${identity.code} ${version.version}`} description={`${projects.join("、")} 将同步使用该正式版本。`} cancelLabel="取消">
            <WorkflowPackageName {...identity} />
            <ActionForm action={releaseFormalAction} hidden={{ requestId: manageable.requestId, scopeProjectId: project?.id, ...listState }} submitText="提交转正电子流并发布" preserveValuesOnSubmit>
              <label className="field">
                <span className="label">转正电子流网址 <span className="required-mark" aria-hidden="true">*</span></span>
                <input className="input" name="flowNo" type="url" required placeholder="https://eflow.example.com/releases/152" />
              </label>
              <label className="field">
                <span className="label">转正评审纪要 <span className="required-mark" aria-hidden="true">*</span></span>
                <textarea className="textarea" name="reviewMinutes" required maxLength={2000} />
              </label>
            </ActionForm>
          </FormDialog> : <GuidanceDialog label={manageable ? "发布正式版本" : "查看发布条件"}
            title="转正发布条件" description={guidance?.description} items={publishGuidance} />}
        </>}
      />
      <FlashMessage notice={notice} />
      {pendingBindingFlows > 0 && <p className="risk-callout">还有 {pendingBindingFlows} 条绑定电子流待审批。请在下方打开绑定验证，完成审批或撤销后再转正。</p>}
      <div className={styles.detailColumns}>
        <section className="card" aria-label="项目验收与绑定证据">
          <div className="card-header"><h2 className={styles.tableHeading}>验收与绑定证据</h2><Badge tone="emerald" dot>{manageable ? "待转正" : "待软件经理发布"}</Badge></div>
          <div className="card-body">
            <div className={styles.nodeList}>
              {evidence.map(({ request, requirements }, index) => {
                const conclusion = request.batchConclusion ? CONCLUSION_META[request.batchConclusion as BatchConclusion] : null;
                const passed = requirements.filter((requirement) => requirement.confirmedAt !== null).length;
                const waived = requirements.filter((requirement) => requirement.waivedAt).length;
                const progress = request.bindingMode === "SKIPPED" ? <Badge tone="slate">无需绑定</Badge>
                  : <Badge tone="teal">{passed + waived}/{requirements.length} 节点已完成</Badge>;
                if (!canAccessProjectPage(user, request.projectId)) return manageable
                  ? <div className="binding-table-item" key={request.id}>
                    <div className={styles.nodeHeading}><strong>{request.projectName}</strong>{progress}</div>
                  </div>
                  : null;
                const trialUrl = releaseFlowUrl(request.trialFormNo);
                return <details className="binding-table-item" key={request.id} open={project ? request.projectId === project.id : index === 0}>
                  <summary className={styles.nodeHeading}>
                    <span><strong>{request.projectName}</strong><span className="small muted">{trialUrl ? "已登记试制电子流" : request.trialFormNo ?? "无试制电子流"}</span></span>
                    {progress}
                    <ChevronDown size={16} aria-hidden="true" />
                  </summary>
                  <div className="binding-table-body">
                    <div className={styles.rowActions}>
                      {trialUrl && <ReleaseFlowEvidence value={trialUrl} label="查看试制电子流" />}
                      {request.releaseMode === "RISK" && <Badge tone="amber">风险发布</Badge>}
                      {request.batchId && <Link href={workflowHref(`/integration/${request.batchId}`, request.projectId)} prefetch={false} className="archive-link">转测批次 {request.batchCode} · {conclusion?.label ?? "已提交"}</Link>}
                      {!request.batchId && <span className="small muted">无关联转测批次</span>}
                      <Link href={workflowHref(`/trial/${request.id}`, request.projectId)} prefetch={false} className="archive-link">查看绑定验证记录</Link>
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
                              {requirement.confirmedAt ? <Badge tone="emerald">节点通过</Badge>
                                : requirement.waivedAt ? <Badge tone="slate">节点免绑定</Badge>
                                : requirement.status === "CANCELLED" && <Badge tone="slate">无需绑定</Badge>}
                              {requirement.legacyConfirmation
                                ? <span className="small muted">历史节点 · 未记录逐条结果</span>
                                : !requirement.waivedAt && <span className="small muted">通过条码 {requirement.passedBarcodeCount}/{requirement.requiredCount}{requirement.failedBarcodeCount > 0 && ` · ${requirement.failedBarcodeCount} 条 FAIL`}</span>}
                            </div>
                            {requirement.waivedAt && <p className="small muted">免绑原因：{requirement.decisionReason} · {requirement.waivedByName ?? "—"} · {formatDateTime(requirement.waivedAt)}</p>}
                            {requirement.confirmedAt && <p className="small muted">{requirement.confirmedByName ?? "—"} 确认通过 · {formatDateTime(requirement.confirmedAt)}</p>}
                            {requirement.flows.filter((flow) => flow.status === "APPROVED").map((flow) => (
                              <div className="formal-flow-line" key={flow.id}>
                                <span className="mono small">{flow.flowNo}</span>
                                {flow.webUrl && <ExternalLink href={flow.webUrl}>网页电子流</ExternalLink>}
                                {flow.barcodeResults.length > 0 && <details className="barcode-details">
                                  <summary>设备条码（{flow.barcodeResults.length}）</summary>
                                  <BindingBarcodeList barcodes={flow.barcodeResults} />
                                </details>}
                              </div>
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
        <aside className={styles.stack} aria-label="版本资料">
          <section className="card">
            <div className="card-header"><h2 className={styles.tableHeading}>版本资料</h2></div>
            <div className="card-body">
              <p className="change-copy">{version.changeSummary}</p>
              <p className="note">试制发布于 {formatDateTime(version.trialReleasedAt)}</p>
              <div className={styles.rowActions}><ExternalLink href={version.archiveUrl}>归档包</ExternalLink><Link href={traceHref} prefetch={false} className="archive-link">版本全链路</Link></div>
            </div>
          </section>
          {trialReviewMinutes && (
            <section className="card" aria-labelledby="formal-trial-review-minutes-heading">
              <div className="card-header"><h2 className={styles.tableHeading} id="formal-trial-review-minutes-heading">试制评审纪要</h2></div>
              <div className="card-body"><p className={styles.reviewMinutesText}>{trialReviewMinutes}</p></div>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
