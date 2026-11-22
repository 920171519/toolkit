import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge, ExternalLink, PageHeader } from "@/components/ui";
import { canManageProjectWorkflowForProject } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { CONCLUSION_META, type BatchConclusion } from "@/lib/constants";
import { requireWorkflowProject } from "@/lib/project-scope";
import { getWorkflowListState } from "@/lib/workflow-list";
import { trialQueueParams, type TrialSearchParams } from "@/lib/trial-queue";
import { workflowHref } from "@/lib/workflow-links";
import { getTrialReadyVersions, getWorkflowProjectScope } from "@/lib/workflow-queries";

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
  if (!row || !canManageProjectWorkflowForProject(user, row.projectId)) notFound();
  const risk = row.riskProjectCount > 0;
  const conclusion = row.batchConclusion ? CONCLUSION_META[row.batchConclusion as BatchConclusion] : null;

  return (
    <>
      <PageHeader
        title={row.packageName + " " + row.version}
        description={row.projectName}
        actions={<Link href={workflowHref("/trial", projectId, { ...trialQueueParams(search), returnTo: getWorkflowListState(search).returnTo })} className="button button-secondary" prefetch={false}>
          <ArrowLeft size={14} />返回试制队列
        </Link>}
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
