import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, ChevronDown } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { canAccessProjectPage, canManageProjectWorkflowForProject } from "@/lib/access";
import { requireWorkflowProject } from "@/lib/project-scope";
import { parseFlash } from "@/lib/queries";
import { workflowHref } from "@/lib/workflow-links";
import { getWorkflowListState } from "@/lib/workflow-list";
import { RiskTrialEntryAction } from "@/components/risk-trial-entry-action";
import { getRiskTrialEntries } from "@/lib/trial-risk-entry";
import { readTraceListState, traceListParams, withTraceTab } from "@/lib/version-trace-list";
import { VersionTraceTabs } from "../trace-tabs";
import { ReleaseFlowEvidence } from "@/components/release-flow-evidence";
import { VersionVoidDialog } from "@/components/version-void-dialog";
import { getTraceVersionTabs, getVersionTrace } from "@/lib/workflow-queries";
import { canVoidPackageVersion } from "@/lib/workflow";
import { formatDateTime } from "@/lib/format";
import { packageIdentity } from "@/lib/package-identity";
import { releaseFlowUrl } from "@/lib/release-flow";
import { BAD_CONCLUSION_LABEL, BATCH_STATUS_META, BINDING_FLOW_STATUS_META, CONCLUSION_META, TRANSFER_REQUEST_STATUS_META } from "@/lib/constants";
import { Badge, ExternalLink, FlashMessage, PageHeader, ProgressBar, StatusPill } from "@/components/ui";
import styles from "@/components/workflow-queue.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "版本全链路" };

const transferStatusFallback: Record<string, { label: string; tone: string }> = {
  PENDING: { label: "待转测", tone: "amber" },
  IN_TEST: { label: "集成测试中", tone: "sky" },
  PASSED: { label: "测试通过", tone: "emerald" },
  FAILED: { label: "测试不通过", tone: "rose" },
  BLOCKED: { label: "无法验证", tone: "amber" },
  TRIAL: { label: "试制中", tone: "teal" },
  PENDING_FORMAL: { label: "待转正", tone: "orange" },
  FORMAL: { label: "已转正", tone: "emerald" },
  VOID: { label: "已作废", tone: "slate" },
  CANCELLED: { label: "已取消", tone: "slate" },
};

export default async function VersionTracePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const search = await searchParams;
  const notice = parseFlash(search.flash, search.tone === "error" ? "error" : "success");
  const versionId = Number(id);
  if (!Number.isSafeInteger(versionId) || versionId < 1) notFound();
  const project = requireWorkflowProject(user, search.project);
  const projectId = project?.id;
  const trace = getVersionTrace(versionId, projectId);
  if (!trace) notFound();
  const { version, requests, batches, details } = trace;
  const identity = packageIdentity({ name: version.packageName, code: version.packageCode });
  const requested = withTraceTab(readTraceListState(search), versionId);
  const tabs = getTraceVersionTabs(requested.tabs, projectId);
  const state = { ...requested, tabs: tabs.map((tab) => tab.id) };
  const detailByRequest = new Map(details.map((detail) => [detail.request.id, detail]));
  const projectIds = new Set([...requests.map((request) => request.projectId), ...batches.map((batch) => batch.projectId)]);
  const linkedProjects = new Set([...projectIds].filter((id) => canAccessProjectPage(user, id)));
  const managedRequests = project?.status === "ARCHIVED" ? [] : requests.filter((request) => canManageProjectWorkflowForProject(user, request.projectId));
  const riskEntries = getRiskTrialEntries(managedRequests.filter((request) => request.status === "PASSED").map((request) => request.requestId));
  const canVoid = project?.status !== "ARCHIVED" && canVoidPackageVersion(user, versionId);
  const fromFormal = search.from === "formal";
  const formalState = getWorkflowListState(search);

  return (
    <>
      <PageHeader
        title={`${identity.code} ${version.version}`}
        description={<>
          {identity.name !== identity.code && <>{identity.name}<br /></>}
          {project && `${project.name} · `}提交人 {version.submittedByName ?? "系统"} · {formatDateTime(version.submittedAt)}
        </>}
        actions={<>
          {fromFormal && <Link href={workflowHref("/formal", projectId, formalState)} prefetch={false} className="button button-secondary"><ArrowLeft size={14} />返回待转正列表</Link>}
          <Link href={workflowHref("/packages", projectId, { open: version.packageId })} prefetch={false} className="button button-secondary">查看软件包</Link>
          {project && <Link href={workflowHref(`/versions/${versionId}`, undefined, { returnTo: state.returnTo })} prefetch={false} className="button button-secondary">查看跨项目版本证据</Link>}
          {canVoid && <VersionVoidDialog versionId={versionId} code={identity.code} version={version.version}
            returnFields={{ ...traceListParams(state), scopeProjectId: projectId, from: fromFormal ? "formal" : undefined }} />}
        </>}
      />

      <VersionTraceTabs state={state} tabs={tabs} projectId={projectId} activeId={versionId} />
      <FlashMessage notice={notice} />
      {version.status === "VOID" && (
        <div className="risk-callout" data-tone="danger" style={{ marginBottom: 14 }}><strong>已作废</strong> · {version.voidReason ?? "未填写原因"}</div>
      )}
      <div className="info-strip" style={{ marginBottom: 16 }}>
        {version.status !== "VOID" && <span><StatusPill status={version.status as "PENDING_TRANSFER" | "IN_TEST" | "PENDING_TRIAL" | "TRIAL" | "PENDING_FORMAL" | "FORMAL"} /></span>}
        <span><strong>{details.reduce((total, detail) => total + detail.requirements.filter((requirement) => requirement.confirmedAt !== null).length, 0)}</strong> 个通过节点</span>
        {version.releaseMode === "RISK" && <Badge tone="rose">风险发布</Badge>}
        {requests.length === 0 && version.trialFormNo && (releaseFlowUrl(version.trialFormNo)
          ? <ReleaseFlowEvidence value={version.trialFormNo} label="查看试制电子流" />
          : <span>试制电子流 {version.trialFormNo}</span>)}
        {requests.length === 0 && version.formFlowNo && (releaseFlowUrl(version.formFlowNo)
          ? <ReleaseFlowEvidence value={version.formFlowNo} label="查看转正电子流" />
          : <span>转正电子流 {version.formFlowNo}</span>)}
        <ExternalLink href={version.archiveUrl}>归档包</ExternalLink>
        {version.buildUrl && <ExternalLink href={version.buildUrl}>构建地址</ExternalLink>}
      </div>
      <p className={styles.versionSummary}>{version.changeSummary}</p>
      {version.riskConclusion && <div className="risk-callout" style={{ marginBottom: 16 }}><strong>风险结论</strong><p>{version.riskConclusion}</p></div>}
      <nav className="version-evidence-navigation" aria-label="版本证据目录">
        <a href="#version-projects">项目与发布状态</a>
        {(version.trialReviewMinutes || version.formalReviewMinutes) && <a href="#version-review-minutes">评审纪要</a>}
        <a href="#version-tests">测试批次与报告</a><a href="#version-binding">绑定证据</a>
      </nav>

      <section id="version-projects" className="card workspace-section-anchor" style={{ marginBottom: 16 }}>
        <div className="card-header"><h2 className={styles.tableHeading}>项目与发布状态</h2><span className={styles.count}>{requests.length} 个项目</span></div>
        <div className="card-body" style={{ padding: 0, marginTop: 12 }}>
          {requests.length === 0 ? <div className="muted-panel" style={{ margin: 16 }}>暂无项目转测记录。</div> : <div className={`table-wrap ${styles.queueTable}`} role="region" aria-label="项目版本证据表格" tabIndex={0}><table className="data-table">
            <thead><tr><th>项目</th><th>转测/验收状态</th><th>集成测试批次</th><th>试制电子流</th><th>绑定进度</th><th>转正</th><th aria-label="操作" /></tr></thead>
            <tbody>{requests.map((request) => {
              const meta = transferStatusFallback[request.status] ?? TRANSFER_REQUEST_STATUS_META[request.status as keyof typeof TRANSFER_REQUEST_STATUS_META];
              const testMeta = request.integrationStatus ? transferStatusFallback[request.integrationStatus] : null;
              const detail = detailByRequest.get(request.requestId);
              const passed = detail?.requirements.filter((requirement) => requirement.confirmedAt || requirement.waivedAt).length ?? 0;
              const total = detail?.requirements.length ?? 0;
              const linked = linkedProjects.has(request.projectId);
              const riskEntry = riskEntries[request.requestId];
              const conclusion = request.batchConclusion ? CONCLUSION_META[request.batchConclusion as keyof typeof CONCLUSION_META]?.label : undefined;
              return (
                <tr key={request.requestId}>
                  <td>{linked ? <Link href={`/projects/${request.projectId}`} style={{ fontWeight: 600 }}>{request.projectName}</Link> : <strong>{request.projectName}</strong>}<div className="small muted">{request.projectCode}</div></td>
                  <td><Badge tone={meta?.tone ?? "slate"}>{meta?.label ?? request.status}</Badge>{testMeta && testMeta.label !== meta?.label && <div className="small muted">验收：{testMeta.label}</div>}{request.status === "FAILED" || request.status === "BLOCKED" ? <div className="small muted">{BAD_CONCLUSION_LABEL[request.status]}</div> : null}</td>
                  <td>{request.batchId ? <>{linked ? <Link href={workflowHref(`/integration/${request.batchId}`, request.projectId)} prefetch={false} className="archive-link">{request.batchCode} <ArrowRight size={11} /></Link> : <span className="mono small">{request.batchCode}</span>}<div className="small muted">{conclusion ?? "待提交结论"}{request.batchReportUrl ? <> · <a href={request.batchReportUrl} className="archive-link">验证报告</a></> : null}</div></> : <span className="small muted">无关联批次</span>}</td>
                  <td><ReleaseFlowEvidence value={request.trialFormNo} label="查看试制电子流" />{request.riskConclusion && request.riskConclusion !== version.riskConclusion && <div className="small muted">风险：{request.riskConclusion}</div>}</td>
                  <td>{total > 0 ? <><ProgressBar value={passed} max={total} /><span className="small muted">{passed}/{total}</span></> : <span className="small muted">—</span>}</td>
                  <td><ReleaseFlowEvidence value={request.formFlowNo} label="查看转正电子流" /></td>
                  <td className="cell-actions">{riskEntry?.stage === "PASSED_NO_EVIDENCE" && <RiskTrialEntryAction entry={riskEntry} packageName={version.packageName} packageCode={version.packageCode} version={version.version} projectName={request.projectName} returnTo={state.returnTo} />}{detail && linked ? <Link href={workflowHref(`/trial/${request.requestId}`, request.projectId)} prefetch={false} className="archive-link">绑定详情 <ArrowRight size={11} /></Link> : null}</td>
                </tr>
              );
            })}</tbody>
          </table></div>}
        </div>
      </section>

      {(version.trialReviewMinutes || version.formalReviewMinutes) && (
        <section id="version-review-minutes" className="card workspace-section-anchor" aria-labelledby="version-review-minutes-heading" style={{ marginBottom: 16 }}>
          <div className="card-header"><h2 className={styles.tableHeading} id="version-review-minutes-heading">评审纪要</h2></div>
          <div className={`card-body ${styles.stack}`}>
            {version.trialReviewMinutes && (
              <section aria-labelledby="version-trial-review-minutes-heading">
                <h3 className={styles.reviewMinutesHeading} id="version-trial-review-minutes-heading">试制评审纪要</h3>
                <p className={styles.reviewMinutesText}>{version.trialReviewMinutes}</p>
              </section>
            )}
            {version.formalReviewMinutes && (
              <section aria-labelledby="version-formal-review-minutes-heading">
                <h3 className={styles.reviewMinutesHeading} id="version-formal-review-minutes-heading">转正评审纪要</h3>
                <p className={styles.reviewMinutesText}>{version.formalReviewMinutes}</p>
              </section>
            )}
          </div>
        </section>
      )}

      <section id="version-tests" className="card workspace-section-anchor" style={{ marginBottom: 16 }}>
        <div className="card-header"><h2 className={styles.tableHeading}>测试批次与报告</h2><span className={styles.count}>{batches.length} 个批次</span></div>
        <div className="card-body" style={{ padding: 0, marginTop: 12 }}>
          {batches.length === 0 ? <div className="muted-panel" style={{ margin: 16 }}>暂无关联集成测试批次。</div> : <div className={`table-wrap ${styles.queueTable}`} role="region" aria-label="集成测试证据表格" tabIndex={0}><table className="data-table">
            <thead><tr><th>批次</th><th>项目</th><th>状态 / 结论</th><th>测试总结</th><th>完成时间</th><th aria-label="操作" /></tr></thead>
            <tbody>{batches.map((batch) => <tr key={batch.id}>
              <td>{linkedProjects.has(batch.projectId) ? <Link href={workflowHref(`/integration/${batch.id}`, batch.projectId)} prefetch={false} style={{ fontWeight: 600 }}>{batch.code}</Link> : <strong>{batch.code}</strong>}</td>
              <td>{batch.projectName}</td>
              <td><Badge tone={batch.conclusion === "PASS" ? "emerald" : batch.conclusion === "FAIL" ? "rose" : "amber"}>{(batch.conclusion ? CONCLUSION_META[batch.conclusion as keyof typeof CONCLUSION_META]?.label : null) ?? BATCH_STATUS_META[batch.status as keyof typeof BATCH_STATUS_META]?.label ?? "已记录"}</Badge></td>
              <td className="small muted" style={{ maxWidth: 420 }}>{batch.testSummary ?? "—"}</td>
              <td className="small muted">{batch.completedAt ? formatDateTime(batch.completedAt) : "—"}</td>
              <td className="cell-actions">{batch.testReportUrl ? <a href={batch.testReportUrl} className="archive-link">验证报告</a> : null}</td>
            </tr>)}</tbody>
          </table></div>}
        </div>
      </section>

      <section id="version-binding" className="card workspace-section-anchor">
        <div className="card-header"><h2 className={styles.tableHeading}>绑定证据</h2><span className={styles.count}>{details.length} 个项目</span></div>
        <div className="card-body" style={{ paddingTop: 12 }}>
          {details.length === 0 ? <div className="muted-panel">该版本尚未发布试制，暂无绑定验证记录。</div> : <div className={styles.nodeList}>{details.map((detail) => (
            <details className="binding-table-item" key={detail.request.id}>
              <summary className={styles.nodeHeading}>
                <span><strong>{detail.request.projectName}</strong><span className="small muted">{releaseFlowUrl(detail.request.trialFormNo) ? "已登记试制电子流" : detail.request.trialFormNo ?? "无试制电子流"}</span></span>
                <Badge tone={detail.request.releaseMode === "RISK" ? "rose" : "violet"}>{detail.request.releaseMode === "RISK" ? "风险发布" : "验收发布"}</Badge>
                <ChevronDown size={16} aria-hidden="true" />
              </summary>
              <div className="binding-table-body">
              {releaseFlowUrl(detail.request.trialFormNo) && <ReleaseFlowEvidence value={detail.request.trialFormNo} label="查看试制电子流" />}
              {linkedProjects.has(detail.request.projectId) && <Link href={workflowHref(`/trial/${detail.request.id}`, detail.request.projectId)} prefetch={false} className="archive-link">查看绑定验证 <ArrowRight size={11} /></Link>}
              {detail.request.bindingMode === "SKIPPED" && <p className="note">无需绑定原因：{detail.request.bindingReason ?? "—"}</p>}
              {detail.requirements.length === 0 && <p className="note">暂无节点绑定记录。</p>}
              {detail.requirements.map((requirement) => (
                <div className="version-trace-requirement" key={requirement.id}>
                  <div className="toolbar" style={{ gap: 8 }}>
                    <span className="chip">{requirement.nodeName}</span>
                    {requirement.confirmedAt ? <Badge tone="emerald">节点通过</Badge>
                      : requirement.waivedAt ? <Badge tone="slate">节点免绑定</Badge>
                      : requirement.status === "CANCELLED" && <Badge tone="slate">{detail.request.status === "VOID" ? "已关闭" : "无需绑定"}</Badge>}
                    <span className="small muted">{requirement.approvedCount}/{requirement.requiredCount} 条码</span>
                  </div>
                  {requirement.confirmedAt && <p className="small muted">{requirement.confirmedByName ?? "—"} 确认通过 · {formatDateTime(requirement.confirmedAt)}</p>}
                  {requirement.waivedAt && <p className="small muted">免绑定原因：{requirement.decisionReason} · {requirement.waivedByName ?? "—"} · {formatDateTime(requirement.waivedAt)}</p>}
                  {requirement.flows.map((flow) => (
                    <div className="version-trace-flow" key={flow.id}>
                      <span className="mono small">{flow.flowNo}</span>
                      <Badge tone={BINDING_FLOW_STATUS_META[flow.status as keyof typeof BINDING_FLOW_STATUS_META]?.tone ?? "slate"}>{BINDING_FLOW_STATUS_META[flow.status as keyof typeof BINDING_FLOW_STATUS_META]?.label ?? "已记录"}</Badge>
                      {flow.webUrl && <ExternalLink href={flow.webUrl} className="flow-web-link">网页电子流</ExternalLink>}
                      <span className="small muted">审批人 {flow.approverName ?? "—"}{flow.reviewComment && ` · ${flow.reviewComment}`}</span>
                      {flow.barcodes.length > 0 && <details className="barcode-details"><summary>设备条码（{flow.barcodes.length}）</summary><div className="barcode-chip-list">{flow.barcodes.map((barcode) => <span key={barcode} className="mono barcode-chip">{barcode}</span>)}</div></details>}
                    </div>
                  ))}
                </div>
              ))}
              </div>
            </details>
          ))}</div>}
        </div>
      </section>
    </>
  );
}
