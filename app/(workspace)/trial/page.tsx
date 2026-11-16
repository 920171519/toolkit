import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ClipboardList } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { canManageProjectWorkflow } from "@/lib/permissions";
import { parseFlash } from "@/lib/queries";
import {
  getTrialReadyVersions,
  getTrialVersions,
  getWorkflowProjectScope,
} from "@/lib/workflow-queries";
import { formatDateTime } from "@/lib/format";
import { BAD_CONCLUSION_LABEL } from "@/lib/constants";
import { releaseTrialAction } from "@/lib/actions/workflow";
import { ActionForm } from "@/components/action-form";
import { Badge, EmptyState, ExternalLink, FlashMessage, PageHeader, ProgressBar } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "试制与绑定验证" };

export default async function TrialPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const notice = parseFlash(params.flash, params.tone === "error" ? "error" : "success");
  const scope = getWorkflowProjectScope(user);
  const canViewReleaseQueue = user.role === "ADMIN" || user.role === "SOFTWARE_MANAGER";
  const ready = canViewReleaseQueue ? getTrialReadyVersions(scope) : [];
  const trials = getTrialVersions(scope);
  const canRelease = (managerId: number | null) => canManageProjectWorkflow(user, managerId);

  return (
    <>
      <PageHeader
        eyebrow="Trial release / Project binding"
        title="试制与绑定验证"
        description="按项目发布试制、按项目节点完成设备条码绑定；每个项目软件经理只处理本项目的待办。"
        actions={<Link href="/packages" className="button button-secondary">查看版本总览</Link>}
      />
      <FlashMessage notice={notice} />
      <div className="info-strip" style={{ marginBottom: 18 }}>
        {canViewReleaseQueue && <span><strong>{ready.length}</strong> 个项目版本待发布试制</span>}
        <span><strong>{trials.length}</strong> 个项目试制版本绑定中</span>
        <span>绑定只覆盖本项目节点</span>
        <span style={{ marginLeft: "auto" }}>试制、绑定、转正均按项目独立运作</span>
      </div>

      {canViewReleaseQueue && <section className="card">
        <div className="card-header"><div><div className="eyebrow">Release gate</div><h2 style={{ marginTop: 5, fontSize: 19 }}>待发布试制</h2><p className="small muted" style={{ marginTop: 3 }}>本项目集成测试已结束的版本。发布时必须提交本项目的发布试制电子流。</p></div><Badge tone="violet">{ready.length} 待处理</Badge></div>
        <div className="card-body" style={{ paddingTop: 14 }}>
          {ready.length === 0 ? (
            <EmptyState title="没有待发试制的项目版本" description="本项目集成测试结束后，版本会进入这里。" />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {ready.map((version) => (
                <article className="card card-muted" key={version.requestId} style={{ padding: 17 }}>
                  <div className="split-row" style={{ alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}>
                      <div className="toolbar" style={{ gap: 8 }}>
                        <Link href={`/packages?open=${version.packageId}`} style={{ fontSize: 15, fontWeight: 600 }}>{version.packageName}</Link>
                        <span className="version-badge">{version.version}</span>
                        <Badge tone="violet" dot>待发试制</Badge>
                        <span className="chip">{version.projectName}</span>
                        {version.integrationStatus !== "PASSED" && <Badge tone="rose">{BAD_CONCLUSION_LABEL[version.integrationStatus] ?? "测试异常"}</Badge>}
                      </div>
                      <p className="change-copy" style={{ marginTop: 7 }}>{version.changeSummary}</p>
                      <div className="toolbar" style={{ gap: 13, marginTop: 8, fontSize: 11, color: "var(--muted)" }}>
                        <span>责任人 {version.ownerName ?? "未指定"}</span>
                        <span>项目软件经理 {version.softwareManagerName ?? "未指定"}</span>
                        <span>提交人 {version.submittedByName ?? "未知"}</span>
                        <ExternalLink href={version.archiveUrl}>归档包</ExternalLink>
                      </div>
                      {version.integrationStatus !== "PASSED" && <div className="risk-callout" style={{ marginTop: 10 }}>本项目集成测试结论非通过，请软件经理结合验证报告确认风险后决定是否发布试制。</div>}
                    </div>
                  </div>
                  <div className="toolbar" style={{ marginTop: 13, paddingTop: 13, borderTop: "1px solid var(--line)", justifyContent: "flex-end" }}>
                    {canRelease(version.softwareManagerId) ? (
                      <details>
                        <summary className="button button-primary button-sm" style={{ listStyle: "none" }}>提交本项目试制电子流</summary>
                        <div style={{ marginTop: 12, minWidth: 360 }}>
                          <ActionForm action={releaseTrialAction} hidden={{ requestId: version.requestId }} submitText="发布本项目试制版本" submitClassName="button-sm" confirmMessage={`确认在 ${version.projectName} 发布 ${version.packageName} ${version.version} 试制版本？`}>
                            <label className="field"><span className="label">发布试制电子流编号 <span className="required-mark">*</span></span><input className="input" name="trialFormNo" required minLength={3} placeholder="例如 EF-TRIAL-N1-OTA-160" /></label>
                          </ActionForm>
                        </div>
                      </details>
                    ) : <span className="small muted">等待本项目软件经理发布试制电子流</span>}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>}

      <section className="card" style={canViewReleaseQueue ? { marginTop: 18 } : undefined}>
        <div className="card-header"><div><div className="eyebrow">Binding verification</div><h2 style={{ marginTop: 5, fontSize: 19 }}>试制版本绑定验证</h2><p className="small muted" style={{ marginTop: 3 }}>仅覆盖本项目全部测试节点。设备条码可由多个批次电子流提交，审批通过数量按条码计算。</p></div><Badge tone="teal">{trials.length} 个版本</Badge></div>
        <div className="card-body" style={{ paddingTop: 14 }}>
          {trials.length === 0 ? (
            <EmptyState title="没有正在绑定验证的试制版本" description="发布试制后，系统会为本项目全部测试节点生成绑定任务。" />
          ) : (
            <div className="three-col">
              {trials.map((version) => (
                <article className="card" key={version.requestId} style={{ padding: 17 }}>
                  <div className="toolbar-spread"><div className="toolbar" style={{ gap: 7 }}><span style={{ fontSize: 14, fontWeight: 600 }}>{version.packageName}</span><span className="version-badge">{version.version}</span></div><Badge tone="teal" dot>绑定验证中</Badge></div>
                  <div className="small muted" style={{ marginTop: 3 }}>{version.projectName} · {version.trialFormNo ?? "—"} · {formatDateTime(version.trialReleasedAt)} 发布</div>
                  <div style={{ marginTop: 14 }}>
                    <div className="split-row small muted" style={{ marginBottom: 6 }}><span>节点绑定通过</span><span>{version.requirementPassed}/{version.requirementTotal}</span></div>
                    <ProgressBar value={version.requirementPassed} max={version.requirementTotal} />
                  </div>
                  <div className="split-row" style={{ marginTop: 12 }}><span className="small muted">{version.pendingFlowCount} 个绑定电子流待审批</span><Link href={`/trial/${version.requestId}`} className="archive-link">处理 <ArrowRight size={12} /></Link></div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
      <div className="muted-panel" style={{ marginTop: 18 }}><ClipboardList size={14} style={{ display: "inline", marginRight: 5, verticalAlign: -2 }} />个人待办只会列出你负责的节点绑定、你审批的电子流，以及本项目软件经理的流程待办。</div>
    </>
  );
}
