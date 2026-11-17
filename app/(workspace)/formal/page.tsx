import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { canManageProjectWorkflowForProject } from "@/lib/access";
import { parseFlash } from "@/lib/queries";
import { getPendingFormalVersions, getTrialDetail, getWorkflowProjectScope } from "@/lib/workflow-queries";
import { formatDateTime } from "@/lib/format";
import { CONCLUSION_META, type BatchConclusion } from "@/lib/constants";
import { releaseFormalAction } from "@/lib/actions/workflow";
import { ActionForm } from "@/components/action-form";
import { Badge, EmptyState, ExternalLink, FlashMessage, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "转正发布" };

export default async function FormalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const notice = parseFlash(params.flash, params.tone === "error" ? "error" : "success");
  const versions = getPendingFormalVersions(getWorkflowProjectScope(user)).map((version) => ({ ...version, detail: getTrialDetail(version.requestId) }));

  return (
    <>
      <PageHeader
        eyebrow="Formal release"
        title="转正发布"
        description="按项目发布转正。本项目全部测试节点绑定验证通过后，版本自动进入本项目待转正；本项目软件经理提交转正电子流后发布正式版本。"
        actions={<Link href="/trial" className="button button-secondary">查看绑定验证 <ArrowRight size={14} /></Link>}
      />
      <FlashMessage notice={notice} />
      <div className="info-strip" style={{ marginBottom: 18 }}>
        <span><strong>{versions.length}</strong> 个版本待转正</span>
        <span>本项目全部测试节点绑定通过</span>
        <span>转正后旧试制版本仍保留历史</span>
      </div>

      <section className="card">
        <div className="card-header"><div><div className="eyebrow">Ready for formal release</div><h2 style={{ marginTop: 5, fontSize: 19 }}>待提交转正电子流</h2><p className="small muted" style={{ marginTop: 3 }}>这些本项目版本已覆盖全部测试节点，并达到每个节点的绑定条码通过数量要求。</p></div><Badge tone="emerald">{versions.length} 待处理</Badge></div>
        <div className="card-body" style={{ paddingTop: 14 }}>
          {versions.length === 0 ? (
            <EmptyState title="没有待转正的版本" description="试制版本完成全部项目节点绑定后会自动进入这里。" />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {versions.map((version) => (
                <article className="card card-muted" key={version.requestId} style={{ padding: 17 }}>
                  <div className="split-row">
                    <div style={{ flex: 1 }}>
                      <div className="toolbar" style={{ gap: 8 }}>
                        <Link href={`/packages?open=${version.packageId}`} style={{ fontSize: 15, fontWeight: 600 }}>{version.packageName}</Link>
                        <span className="version-badge">{version.version}</span>
                        <Badge tone="emerald" dot>待转正</Badge>
                        <span className="chip">{version.projectName}</span>
                      </div>
                      <p className="change-copy" style={{ marginTop: 7 }}>{version.changeSummary}</p>
                      {version.detail && (
                        <details className="formal-binding-details">
                          <summary>查看实际绑定条码与电子流（{version.detail.requirements.reduce((total, item) => total + item.flows.filter((flow) => flow.status === "APPROVED").reduce((sum, flow) => sum + flow.barcodes.length, 0), 0)} 个通过条码）</summary>
                          <div className="formal-requirement-list">
                            {version.detail.requirements.map((requirement) => (
                              <div className="formal-requirement" key={requirement.id}>
                                <div className="toolbar" style={{ gap: 7 }}>
                                  <span className="chip">{requirement.nodeName}</span>
                                  <Badge tone={requirement.status === "PASSED" ? "emerald" : "amber"}>{requirement.status === "PASSED" ? "节点通过" : "待通过"}</Badge>
                                  <span className="small muted">通过条码 {requirement.approvedCount}/{requirement.requiredCount}</span>
                                </div>
                                {requirement.flows.filter((flow) => flow.status === "APPROVED").map((flow) => (
                                  <div className="formal-flow-line" key={flow.id}>
                                    <span className="mono small">{flow.flowNo}</span>
                                    <span className="small">{flow.barcodes.length} 个条码：{flow.barcodes.join("、")}</span>
                                    {flow.webUrl && <ExternalLink href={flow.webUrl}>网页电子流</ExternalLink>}
                                  </div>
                                ))}
                              </div>
                            ))}
                          </div>
                          <Link href={`/trial/${version.requestId}`} className="archive-link" style={{ marginTop: 8 }}>进入绑定验证详情 <ArrowRight size={11} /></Link>
                        </details>
                      )}
                      <div className="toolbar" style={{ gap: 14, marginTop: 8, fontSize: 11, color: "var(--muted)" }}>
                        <span>试制电子流 {version.trialFormNo ?? "—"}</span>
                        <span>发布 {formatDateTime(version.trialReleasedAt)}</span>
                        <span>绑定节点 {version.requirementPassed}/{version.requirementTotal} 通过</span>
                        {version.detail?.request.batchId ? (
                          <Link href={`/integration/${version.detail.request.batchId}`} className="archive-link">
                            转测批次 {version.detail.request.batchCode}
                            {version.detail.request.batchConclusion ? ` · ${CONCLUSION_META[version.detail.request.batchConclusion as BatchConclusion]?.label}` : ""}
                          </Link>
                        ) : (
                          <Badge tone="rose">风险发布</Badge>
                        )}
                        {version.detail?.request.riskConclusion && <span>风险结论 {version.detail.request.riskConclusion}</span>}
                        <ExternalLink href={version.archiveUrl}>归档包</ExternalLink>
                      </div>
                    </div>
                    <div style={{ minWidth: 280 }}>
                      {canManageProjectWorkflowForProject(user, version.projectId) ? (
                        <ActionForm action={releaseFormalAction} hidden={{ requestId: version.requestId }} submitText="提交转正电子流并发布" submitClassName="button-sm" confirmMessage={`确认发布 ${version.packageName} ${version.version} 正式版本？`}>
                          <label className="field"><span className="label">转正电子流 <span className="required-mark">*</span></span><input className="input" name="flowNo" required minLength={3} placeholder="例如 EF-OTA-152" /></label>
                        </ActionForm>
                      ) : <span className="small muted">等待本项目软件经理提交转正电子流</span>}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
      <div className="muted-panel" style={{ marginTop: 18 }}><ShieldCheck size={14} style={{ display: "inline", marginRight: 5, verticalAlign: -2 }} />转正条件：本项目所有测试节点均已达到绑定通过数量，且没有待审批的绑定电子流影响验证结论。作废的本项目试制版本不会进入转正。</div>
    </>
  );
}
