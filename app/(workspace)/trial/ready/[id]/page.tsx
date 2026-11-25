import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge, ExternalLink, PageHeader } from "@/components/ui";
import { GuidanceDialog } from "@/components/guidance-dialog";
import { TrialReleaseAction } from "@/components/trial-release-action";
import { VersionVoidDialog } from "@/components/version-void-dialog";
import { canManageProjectWorkflowForProject } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { CONCLUSION_META, type BatchConclusion } from "@/lib/constants";
import { one } from "@/lib/db";
import { packageIdentity } from "@/lib/package-identity";
import { requireWorkflowProject } from "@/lib/project-scope";
import { getTrialReleaseGuidance } from "@/lib/release-guidance";
import { getWorkflowListState } from "@/lib/workflow-list";
import { trialQueueParams, type TrialSearchParams } from "@/lib/trial-queue";
import { trialReleaseStateKey } from "@/lib/trial-release-state";
import { workflowHref } from "@/lib/workflow-links";
import { getTrialReadyVersions, getWorkflowProjectScope } from "@/lib/workflow-queries";
import styles from "@/components/workflow-queue.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "待发布试制详情" };

export default async function TrialReadyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<TrialSearchParams>;
}) {
  const user = await requireUser();
  if (user.role !== "ADMIN" && user.role !== "SOFTWARE_MANAGER") notFound();
  const requestId = Number((await params).id);
  if (!Number.isSafeInteger(requestId) || requestId < 1) notFound();
  const search = await searchParams;
  const projectId = requireWorkflowProject(user, search.project)?.id;
  const scope = projectId === undefined ? getWorkflowProjectScope(user) : [projectId];
  const [row] = getTrialReadyVersions(scope, { requestId });
  const returnTo = getWorkflowListState(search).returnTo;
  const queue = { ...trialQueueParams(search), ...(returnTo ? { returnTo } : {}) };
  const back = <Link href={workflowHref("/trial", projectId, queue)} className="button button-secondary" prefetch={false}>
    <ArrowLeft size={14} />返回试制队列
  </Link>;
  if (!row) {
    const request = one<{ versionId: number; projectId: number; trialReleasedAt: string | null; versionStatus: string; projectStatus: string }>(
      `SELECT r.package_version_id AS versionId, r.project_id AS projectId, r.trial_released_at AS trialReleasedAt,
              pv.status AS versionStatus, p.status AS projectStatus
       FROM version_transfer_requests r JOIN package_versions pv ON pv.id = r.package_version_id
       JOIN projects p ON p.id = r.project_id WHERE r.id = ?`, requestId,
    );
    if (!request || (projectId !== undefined && projectId !== request.projectId)
      || !canManageProjectWorkflowForProject(user, request.projectId)) notFound();
    const guidance = getTrialReleaseGuidance(user, request.versionId, { projectId: request.projectId, returnTo });
    const ongoingTrial = request.trialReleasedAt && request.projectStatus !== "ARCHIVED";
    const nextHref = ongoingTrial && request.versionStatus === "PENDING_FORMAL"
      ? workflowHref(`/formal/${request.versionId}`, request.projectId, { returnTo })
      : ongoingTrial && request.versionStatus === "TRIAL"
        ? workflowHref(`/trial/${requestId}`, request.projectId, { ...queue, view: "binding" })
        : workflowHref(`/versions/${request.versionId}`, projectId, { returnTo });
    const heading = request.versionStatus === "FORMAL" ? "该版本已转正"
      : request.versionStatus === "VOID" ? "该版本已作废"
        : ongoingTrial ? "该版本已发布试制" : "该版本暂未入列";
    return <>
      <PageHeader title="试制发布条件" description={guidance?.description} actions={back} />
      <section className={styles.nextAction}>
        <h2>{heading}</h2>
        {guidance?.items.length
          ? <GuidanceDialog label="查看试制条件" title="试制发布条件" description={guidance.description} items={guidance.items} />
          : <Link href={nextHref} prefetch={false} className="button button-secondary">查看版本当前阶段</Link>}
      </section>
    </>;
  }
  if (!canManageProjectWorkflowForProject(user, row.projectId)) notFound();
  const risk = row.riskProjectCount > 0;
  const conclusion = row.batchConclusion ? CONCLUSION_META[row.batchConclusion as BatchConclusion] : null;
  const identity = packageIdentity({ name: row.packageName, code: row.packageCode });
  const records = getTrialReadyVersions(getWorkflowProjectScope(user), { versionId: row.versionId });

  return (
    <>
      <PageHeader
        title={`${identity.code} ${row.version}`}
        description={identity.name !== identity.code ? `${identity.name} · ${row.projectName}` : row.projectName}
        actions={<>
          {back}
          <TrialReleaseAction actor={user} row={row} records={records} projectId={projectId} query={queue}
            triggerClassName="button button-primary" />
          <VersionVoidDialog versionId={row.versionId} code={identity.code} version={row.version}
            returnFields={{ ...queue, requestId, scopeProjectId: projectId, eligibility: trialReleaseStateKey(row), voidFrom: "trial-queue" }} />
        </>}
      />
      <section className="card" aria-labelledby="trial-ready-evidence">
        <div className="card-header">
          <h2 id="trial-ready-evidence">{risk ? "风险发布原因" : "验收结论"}</h2>
          <Badge tone={risk ? "rose" : "violet"} dot>{risk ? "风险发布" : "待发试制"}</Badge>
        </div>
        <div className="card-body">
          {risk ? (
            <>
              <p style={{ whiteSpace: "pre-wrap" }}>{row.riskConclusion}</p>
              {row.ongoingTestCount > 0 && <p className="small muted" style={{ marginTop: 6 }}>仍有 {row.ongoingTestCount} 个待发起或在测批次，完成前无法转正。</p>}
            </>
          ) : (
            <>
              <div className="trial-source-line">
                <strong>{conclusion?.label ?? "通过"}</strong>
                {row.batchId && <Link href={workflowHref("/integration/" + row.batchId, projectId)} className="archive-link" prefetch={false}>
                  {row.batchCode ?? "查看批次"}
                </Link>}
                {row.batchReportUrl && <ExternalLink href={row.batchReportUrl}>验证报告</ExternalLink>}
              </div>
              {row.batchTestSummary && <p style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>{row.batchTestSummary}</p>}
            </>
          )}
        </div>
      </section>
      <section className="card" aria-labelledby="trial-ready-version" style={{ marginTop: 16 }}>
        <div className="card-header"><h2 id="trial-ready-version">版本信息</h2><ExternalLink href={row.archiveUrl}>归档包</ExternalLink></div>
        <div className="card-body">
          <div className="small muted" style={{ marginBottom: 8 }}>提交人 {row.submittedByName ?? "未知"}</div>
          <p style={{ whiteSpace: "pre-wrap" }}>{row.changeSummary}</p>
        </div>
      </section>
    </>
  );
}
