import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { canAccessProjectPage, canManageProjectWorkflowForProject } from "@/lib/access";
import { requireWorkflowProject } from "@/lib/project-scope";
import { parseFlash } from "@/lib/queries";
import { workflowHref } from "@/lib/workflow-links";
import { getPendingFormalVersions, getTrialDetail, getVersionRequestIds, getWorkflowProjectScope } from "@/lib/workflow-queries";
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
  const project = requireWorkflowProject(user, params.project);
  const rawVersions = getPendingFormalVersions(project ? [project.id] : getWorkflowProjectScope(user));
  const groups = new Map<number, typeof rawVersions>();
  for (const version of rawVersions) {
    const group = groups.get(version.versionId) ?? [];
    group.push(version);
    groups.set(version.versionId, group);
  }
  const versions = [...groups.values()].map((group) => {
    const first = group[0];
    const details = getVersionRequestIds(first.versionId)
      .map((requestId) => getTrialDetail(requestId))
      .filter((detail): detail is NonNullable<ReturnType<typeof getTrialDetail>> => detail !== null);
    const requirements = details.flatMap((detail) =>
      detail.requirements.map((requirement) => ({ ...requirement, projectName: detail.request.projectName })),
    );
    const passed = requirements.filter((requirement) => requirement.status === "PASSED").length;
    const waived = requirements.filter((requirement) => requirement.waivedAt).length;
    const approvedBarcodes = requirements.reduce(
      (total, requirement) => total + requirement.flows
        .filter((flow) => flow.status === "APPROVED")
        .reduce((sum, flow) => sum + flow.barcodes.length, 0),
      0,
    );
    const risk = details.some((detail) => detail.request.releaseMode === "RISK" || !detail.request.batchId);
    const skipped = details.some((detail) => detail.request.bindingMode === "SKIPPED");
    return { ...first, details, requirements, passed, waived, approvedBarcodes, risk, skipped };
  });

  return (
    <>
      <PageHeader
        eyebrow="Formal release"
        title="转正发布"
        description={project
          ? `${project.name} · 处理本项目待转正的版本。发布前可核对共享版本在各使用项目的绑定证据。`
          : "全部使用项目完成绑定验证后，软件经理提交一次转正电子流，所有项目同步转正。"}
        actions={<Link href={workflowHref("/trial", project?.id)} className="button button-secondary">查看绑定验证 <ArrowRight size={14} /></Link>}
      />
      <FlashMessage notice={notice} />
      <div className="info-strip" style={{ marginBottom: 18 }}>
        <span><strong>{versions.length}</strong> 个软件包版本待转正</span>
        <span>全部使用项目完成绑定或确认无需绑定后进入转正</span>
        <span>一次转正，全项目同步为正式版本</span>
      </div>

      <section className="card">
        <div className="card-header"><div><div className="eyebrow">Ready for formal release</div><h2 style={{ marginTop: 5, fontSize: 19 }}>待提交转正电子流</h2><p className="small muted" style={{ marginTop: 3 }}>展示所有使用项目的绑定条码、绑定电子流、跳过绑定理由和验收证据。</p></div><Badge tone="emerald">{versions.length} 待处理</Badge></div>
        <div className="card-body" style={{ paddingTop: 14 }}>
          {versions.length === 0 ? (
            <EmptyState title="没有待转正的版本" description="试制版本完成全部使用项目节点绑定，或软件经理确认无需绑定后会自动进入这里。" />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {versions.map((version) => (
                <article className="card card-muted" key={version.versionId} style={{ padding: 17 }}>
                  <div className="split-row">
                    <div style={{ flex: 1 }}>
                      <div className="toolbar" style={{ gap: 8, flexWrap: "wrap" }}>
                        <Link href={workflowHref("/packages", project?.id, { open: version.packageId })} style={{ fontSize: 15, fontWeight: 600 }}>{version.packageName}</Link>
                        <span className="version-badge">{version.version}</span>
                        <Badge tone="emerald" dot>待转正</Badge>
                        {version.risk && <Badge tone="rose">风险发布</Badge>}
                        {version.skipped && <Badge tone="slate">无需绑定</Badge>}
                        {version.isOverdue ? <Badge tone="rose">已超期</Badge> : null}
                        {project
                          ? <span className="chip">{project.name}</span>
                          : version.details.map((detail) => <span className="chip" key={detail.request.id}>{detail.request.projectName}</span>)}
                      </div>
                      <p className="change-copy" style={{ marginTop: 7 }}>{version.changeSummary}</p>
                      {version.details.length > 0 && (
                        <details className="formal-binding-details">
                          <summary>{version.skipped ? "查看无需绑定的理由与项目记录" : "查看全部项目实际绑定条码与电子流"}（{version.approvedBarcodes} 个通过条码，{version.passed}/{version.requirements.length} 个节点通过{version.waived ? `，${version.waived} 个节点免绑定` : ""}）</summary>
                          <div className="formal-requirement-list">
                            {version.details.map((detail) => {
                              const batchConclusion = detail.request.batchConclusion
                                ? CONCLUSION_META[detail.request.batchConclusion as BatchConclusion]
                                : null;
                              return (
                                <div key={detail.request.id} className="formal-project-evidence">
                                  <div className="toolbar" style={{ gap: 7, flexWrap: "wrap" }}>
                                    <span className="chip">{detail.request.projectName}</span>
                                    <span className="small muted">试制电子流 {detail.request.trialFormNo ?? "—"}</span>
                                    {detail.request.riskConclusion && <span className="small muted">风险结论：{detail.request.riskConclusion}</span>}
                                    {detail.request.bindingMode === "SKIPPED" && <span className="small muted">无需绑定原因：{detail.request.bindingReason ?? "—"}</span>}
                                    {detail.request.batchId && (canAccessProjectPage(user, detail.request.projectId)
                                      ? <Link href={workflowHref(`/integration/${detail.request.batchId}`, detail.request.projectId === project?.id ? project.id : undefined)} className="archive-link">转测批次 {detail.request.batchCode} · {batchConclusion?.label ?? "已提交"}</Link>
                                      : <span className="small muted">转测批次 {detail.request.batchCode} · {batchConclusion?.label ?? "已提交"}</span>)}
                                  </div>
                                  {detail.requirements.map((requirement) => (
                                    <div className="formal-requirement" key={requirement.id}>
                                      <div className="toolbar" style={{ gap: 7 }}>
                                        <span className="chip">{requirement.nodeName}</span>
                                        <Badge tone={requirement.status === "PASSED" ? "emerald" : requirement.status === "CANCELLED" ? "slate" : "amber"}>{requirement.status === "PASSED" ? "节点通过" : requirement.waivedAt ? "节点免绑定" : requirement.status === "CANCELLED" ? "无需绑定" : "待通过"}</Badge>
                                        <span className="small muted">通过条码 {requirement.approvedCount}/{requirement.requiredCount}</span>
                                      </div>
                                      {requirement.waivedAt && <p className="small muted">免绑定原因：{requirement.decisionReason} · {requirement.waivedByName ?? "—"} · {formatDateTime(requirement.waivedAt)}</p>}
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
                              );
                            })}
                          </div>
                          <div className="toolbar" style={{ gap: 10, marginTop: 8, flexWrap: "wrap" }}>
                            {version.details.filter((detail) => canAccessProjectPage(user, detail.request.projectId)).map((detail) => (
                              <Link key={detail.request.id} href={workflowHref(`/trial/${detail.request.id}`, detail.request.projectId === project?.id ? project.id : undefined)} className="archive-link">进入 {detail.request.projectName} 绑定验证详情 <ArrowRight size={11} /></Link>
                            ))}
                            <Link href={workflowHref(`/versions/${version.versionId}`, project?.id)} className="archive-link">查看版本链路 <ArrowRight size={11} /></Link>
                          </div>
                        </details>
                      )}
                      <div className="toolbar" style={{ gap: 14, marginTop: 8, fontSize: 11, color: "var(--muted)", flexWrap: "wrap" }}>
                        <span>试制电子流 {version.trialFormNo ?? "—"}</span>
                        <span>发布 {formatDateTime(version.trialReleasedAt)}</span>
                        {version.isOverdue ? <span style={{ color: "var(--danger)" }}>已超期，超过 {version.trialOverdueDays} 天未转正</span> : null}
                        <span>{version.skipped ? "全项目无需绑定验证" : `全项目节点 ${version.passed}/${version.requirements.length} 通过${version.waived ? `，${version.waived} 个节点免绑定` : ""}`}</span>
                        <ExternalLink href={version.archiveUrl}>归档包</ExternalLink>
                      </div>
                    </div>
                    <div style={{ minWidth: 280 }}>
                      {canManageProjectWorkflowForProject(user, version.projectId) ? (
                        <ActionForm action={releaseFormalAction} hidden={{ requestId: version.requestId, scopeProjectId: project?.id }} submitText="提交转正电子流并发布" submitClassName="button-sm" confirmMessage={`确认将 ${version.packageName} ${version.version} 在全部使用项目同步转正？`}>
                          <label className="field"><span className="label">转正电子流 <span className="required-mark">*</span></span><input className="input" name="flowNo" required minLength={3} placeholder="例如 EF-OTA-152" /></label>
                        </ActionForm>
                      ) : <span className="small muted">等待使用该软件包的项目软件经理发布转正</span>}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
      <div className="muted-panel" style={{ marginTop: 16 }}><ShieldCheck size={14} style={{ display: "inline", marginRight: 5, verticalAlign: -2 }} />转正按软件包版本共享：全部使用项目绑定通过后，一次电子流即可把所有项目同步为正式版本；转正前可展开核对每个项目的条码和网页电子流。</div>
    </>
  );
}
