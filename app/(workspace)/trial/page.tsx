import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ClipboardList } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { canManageProjectWorkflowForProject } from "@/lib/access";
import { parseFlash } from "@/lib/queries";
import {
  getTrialReadyVersions,
  getTrialVersions,
  getWorkflowProjectScope,
} from "@/lib/workflow-queries";
import { BAD_CONCLUSION_LABEL, CONCLUSION_META, type BatchConclusion } from "@/lib/constants";
import { abandonTrialReleaseAction, releaseTrialAction } from "@/lib/actions/workflow";
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
  const canRelease = (projectId: number) => canManageProjectWorkflowForProject(user, projectId);
  const riskCount = ready.filter((version) => version.riskProjectCount > 0).length;

  return (
    <>
      <PageHeader
        eyebrow="Trial release / Project binding"
        title="试制与绑定验证"
        description="试制按软件包版本全项目共享，绑定按项目节点验证；所有使用项目完成集成验收后，任意项目软件经理即可发布一次试制。"
        actions={<Link href="/packages" className="button button-secondary">查看版本总览</Link>}
      />
      <FlashMessage notice={notice} />
      <div className="info-strip" style={{ marginBottom: 16 }}>
        {canViewReleaseQueue && <span><strong>{ready.length}</strong> 个版本待发布试制</span>}
        {canViewReleaseQueue && <span><strong>{riskCount}</strong> 个风险发布</span>}
        <span><strong>{trials.length}</strong> 个项目试制版本绑定中</span>
        <span style={{ marginLeft: "auto" }}>试制/转正按软件包版本全项目共享，绑定任务由软件经理决定是否推送</span>
      </div>

      {canViewReleaseQueue && <section className="card">
        <div className="card-header"><div><div className="eyebrow">Release gate</div><h2 style={{ marginTop: 5, fontSize: 19 }}>待发布试制</h2><p className="small muted" style={{ marginTop: 3 }}>显示集成测试已结束的版本和风险发布版本；可以选择发布共享试制，也可以提交结论后放弃发布试制。</p></div><Badge tone={riskCount > 0 ? "rose" : "violet"}>{ready.length} 待处理</Badge></div>
        <div className="card-body" style={{ paddingTop: 12 }}>
          {ready.length === 0 ? (
            <EmptyState title="没有待发试制的项目版本" description="本项目集成测试结束后，版本会进入这里；无转测批次的风险发布也会显示在这里。" />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {ready.map((version) => {
                const risk = version.riskProjectCount > 0;
                const conclusion = version.batchConclusion ? CONCLUSION_META[version.batchConclusion as BatchConclusion] : null;
                return (
                  <article className="card card-muted" key={version.requestId} style={{ padding: 14 }}>
                    <div className="split-row" style={{ alignItems: "flex-start", gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="toolbar" style={{ gap: 7, flexWrap: "wrap" }}>
                          <Link href={`/packages?open=${version.packageId}`} style={{ fontSize: 14, fontWeight: 600 }}>{version.packageName}</Link>
                          <span className="version-badge">{version.version}</span>
                          <span className="chip">{version.projectName}</span>
                          <span className="small muted">覆盖 {version.versionProjectCount} 个项目</span>
                          <Badge tone={risk ? "rose" : "violet"} dot>{risk ? "风险发布" : "待发试制"}</Badge>
                          {version.integrationStatus !== "PASSED" && <Badge tone="rose">{BAD_CONCLUSION_LABEL[version.integrationStatus] ?? "测试异常"}</Badge>}
                          {version.riskProjectCount > 0 && <span className="small muted">{version.riskProjectCount} 个项目需风险结论</span>}
                        </div>
                        <p className="change-copy" style={{ marginTop: 6 }}>{version.changeSummary}</p>
                        <div className="toolbar" style={{ gap: 12, marginTop: 6, fontSize: 11, color: "var(--muted)", flexWrap: "wrap" }}>
                          <span>责任人 {version.ownerName ?? "未指定"}</span>
                          <span>项目软件经理 {version.softwareManagerName ?? "未指定"}</span>
                          <span>提交人 {version.submittedByName ?? "未知"}</span>
                          <ExternalLink href={version.archiveUrl}>归档包</ExternalLink>
                        </div>
                        <div className="trial-source-line">
                          {version.batchId ? (
                            <>
                              <Link href={`/integration/${version.batchId}`} className="archive-link">转测批次 {version.batchCode} <ArrowRight size={11} /></Link>
                              <span className="small muted">验收结论：{conclusion?.label ?? "已提交"}</span>
                              {version.batchReportUrl && <ExternalLink href={version.batchReportUrl}>验证报告</ExternalLink>}
                              {version.batchTestSummary && <span className="small muted trial-summary">{version.batchTestSummary}</span>}
                            </>
                          ) : (
                            <span className="small muted">未关联转测批次，按风险发布处理</span>
                          )}
                        </div>
                        {(risk || version.riskConclusion) && (
                          <div className="risk-callout" style={{ marginTop: 8 }}>
                            {version.riskConclusion ? `风险结论：${version.riskConclusion}` : "该版本存在未通过集成测试或无批次的关联项目，发布试制时需填写全版本风险结论。"}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="toolbar" style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line)", justifyContent: "flex-end" }}>
                      {canRelease(version.projectId) ? (
                        <div className="toolbar" style={{ gap: 8, flexWrap: "wrap" }}>
                          <details>
                            <summary className="button button-primary button-sm" style={{ listStyle: "none" }}>发布全项目共享试制</summary>
                            <div style={{ marginTop: 10, minWidth: 380 }}>
                              <ActionForm action={releaseTrialAction} hidden={{ requestId: version.requestId }} submitText="发布全项目共享试制版本" submitClassName="button-sm" confirmMessage={`确认发布 ${version.packageName} ${version.version} 共享试制版本？将同步覆盖该软件包全部 ${version.versionProjectCount} 个使用项目。`}>
                                <label className="field"><span className="label">发布试制电子流 <span className="required-mark">*</span></span><input className="input" name="trialFormNo" required minLength={3} placeholder="例如 EF-TRIAL-N1-OTA-160" /></label>
                                {risk && <label className="field" style={{ marginTop: 9 }}><span className="label">风险发布结论 <span className="required-mark">*</span></span><textarea className="textarea" name="riskConclusion" required minLength={5} defaultValue={version.riskConclusion ?? ""} placeholder="说明未通过集成测试或无转测批次的项目原因及全版本风险评估结论。" /></label>}
                              </ActionForm>
                            </div>
                          </details>
                          <details>
                            <summary className="button button-ghost button-sm" style={{ listStyle: "none" }}>放弃发布试制</summary>
                            <div style={{ marginTop: 10, minWidth: 380 }}>
                              <ActionForm action={abandonTrialReleaseAction} hidden={{ requestId: version.requestId }} submitText="提交结论并放弃试制" submitVariant="danger" submitClassName="button-sm" confirmMessage={`确认不发布 ${version.packageName} ${version.version} 试制？该版本将作废，不再用于项目。`}>
                                <label className="field"><span className="label">放弃发布试制结论 <span className="required-mark">*</span></span><textarea className="textarea" name="conclusion" required minLength={5} placeholder="例如：该版本仅用于验证临时问题，不计划发布正式版本，因此不进入试制。" /></label>
                              </ActionForm>
                            </div>
                          </details>
                        </div>
                      ) : <span className="small muted">等待使用该软件包的项目软件经理发布试制</span>}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>}

      <section className="card" style={canViewReleaseQueue ? { marginTop: 16 } : undefined}>
        <div className="card-header"><div><div className="eyebrow">Binding verification</div><h2 style={{ marginTop: 5, fontSize: 19 }}>试制版本绑定验证</h2><p className="small muted" style={{ marginTop: 3 }}>仅覆盖本项目全部测试节点；设备条码按审批通过数量计算。</p></div><Badge tone="teal">{trials.length} 个版本</Badge></div>
        <div className="card-body" style={{ padding: 0, marginTop: 12 }}>
          {trials.length === 0 ? (
            <EmptyState title="没有正在绑定验证的试制版本" description="发布试制后，系统会为本项目全部测试节点生成绑定任务。" />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>软件包 / 版本</th><th>项目</th><th>发布来源</th><th>试制电子流</th><th>节点绑定</th><th>待审批</th><th aria-label="操作" /></tr></thead>
                <tbody>
                  {trials.map((version) => {
                    const risk = version.releaseMode === "RISK" || !version.batchId;
                    return (
                      <tr key={version.requestId}>
                        <td><Link href={`/packages?open=${version.packageId}`} style={{ fontWeight: 600 }}>{version.packageName}</Link><div className="small muted">{version.version}</div></td>
                        <td><span className="chip">{version.projectName}</span></td>
                        <td>{risk ? <Badge tone="rose">风险发布</Badge> : <span className="small">{version.batchCode ? "集成测试通过" : "集成测试"}</span>}{version.isOverdue ? <div style={{ marginTop: 4 }}><Badge tone="rose">已超期</Badge></div> : null}{version.bindingMode === "SKIPPED" ? <div style={{ marginTop: 4 }}><Badge tone="slate">跳过绑定</Badge></div> : version.bindingMode === "PENDING" ? <div style={{ marginTop: 4 }}><Badge tone="amber">待推送绑定</Badge></div> : null}{version.riskConclusion && <div className="small muted" title={version.riskConclusion}>风险结论：{version.riskConclusion.slice(0, 26)}{version.riskConclusion.length > 26 ? "…" : ""}</div>}</td>
                        <td className="small mono">{version.trialFormNo ?? "—"}</td>
                        <td><div className="toolbar" style={{ gap: 8 }}><ProgressBar value={version.requirementPassed} max={version.requirementTotal} /><span className="small muted">{version.requirementPassed}/{version.requirementTotal}</span></div></td>
                        <td><span className="small muted">{version.pendingFlowCount}</span></td>
                        <td className="cell-actions"><Link href={`/trial/${version.requestId}`} className="archive-link">处理 <ArrowRight size={11} /></Link></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
      <div className="muted-panel" style={{ marginTop: 16 }}><ClipboardList size={14} style={{ display: "inline", marginRight: 5, verticalAlign: -2 }} />个人待办只会列出你负责的节点绑定、你审批的电子流，以及本项目软件经理的流程待办。</div>
    </>
  );
}
