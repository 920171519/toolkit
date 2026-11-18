import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Link2 } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { canManageProjectWorkflowForProject } from "@/lib/access";
import { parseFlash } from "@/lib/queries";
import { voidPackageVersionAction } from "@/lib/actions/workflow";
import { ActionForm } from "@/components/action-form";
import { getVersionTrace } from "@/lib/workflow-queries";
import { formatDateTime } from "@/lib/format";
import { BAD_CONCLUSION_LABEL, TRANSFER_REQUEST_STATUS_META } from "@/lib/constants";
import { Badge, ExternalLink, FlashMessage, PageHeader, ProgressBar, StatusPill } from "@/components/ui";

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
  if (!Number.isInteger(versionId)) notFound();
  const trace = getVersionTrace(versionId);
  if (!trace) notFound();
  const { version, requests, batches, details } = trace;
  const detailByRequest = new Map(details.map((detail) => [detail.request.id, detail]));
  const canManage = requests.some((request) => canManageProjectWorkflowForProject(user, request.projectId));
  const canVoid = canManage && ["TRIAL", "PENDING_FORMAL", "FORMAL"].includes(version.status);

  return (
    <>
      <PageHeader
        eyebrow="Version trace / Full evidence"
        title={`${version.packageName} ${version.version}`}
        description={`${version.packageCode} · 提交人 ${version.submittedByName ?? "系统"} · ${formatDateTime(version.submittedAt)}`}
        actions={<><Link href={`/packages?open=${version.packageId}`} className="button button-secondary"><ArrowLeft size={14} />返回软件包</Link><Link href="/overview" className="button button-secondary">部门总览</Link></>}
      />

      <FlashMessage notice={notice} />
      <div className="info-strip" style={{ marginBottom: 16 }}>
        <span><StatusPill status={version.status as "PENDING_TRANSFER" | "IN_TEST" | "PENDING_TRIAL" | "TRIAL" | "PENDING_FORMAL" | "FORMAL" | "VOID"} /></span>
        <span><strong>{requests.length}</strong> 个项目版本</span>
        <span><strong>{batches.length}</strong> 个集成测试批次</span>
        <span><strong>{details.reduce((total, detail) => total + detail.requirements.filter((requirement) => requirement.status === "PASSED").length, 0)}</strong> 个通过节点</span>
        {version.releaseMode === "RISK" && <Badge tone="rose">风险发布</Badge>}
        {version.riskConclusion && <span>风险结论：{version.riskConclusion}</span>}
        <ExternalLink href={version.archiveUrl}>归档包</ExternalLink>
        {version.buildUrl && <ExternalLink href={version.buildUrl}>构建地址</ExternalLink>}
      </div>

      <section className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><div><h2 style={{ fontSize: 18 }}>项目版本与验收联动</h2><p className="small muted" style={{ marginTop: 3 }}>从项目转测、集成测试批次/结论到试制、绑定、转正的完整项目视图。</p></div><Badge tone="slate">{requests.length} 个项目</Badge></div>
        <div className="card-body" style={{ padding: 0, marginTop: 12 }}>
          <div className="table-wrap"><table className="data-table">
            <thead><tr><th>项目</th><th>转测/验收状态</th><th>集成测试批次</th><th>试制电子流</th><th>绑定进度</th><th>转正</th><th aria-label="操作" /></tr></thead>
            <tbody>{requests.map((request) => {
              const meta = transferStatusFallback[request.status] ?? TRANSFER_REQUEST_STATUS_META[request.status as keyof typeof TRANSFER_REQUEST_STATUS_META];
              const detail = detailByRequest.get(request.requestId);
              const passed = detail?.requirements.filter((requirement) => requirement.status === "PASSED").length ?? 0;
              const total = detail?.requirements.length ?? 0;
              return (
                <tr key={request.requestId}>
                  <td><Link href={`/projects/${request.projectId}`} style={{ fontWeight: 600 }}>{request.projectName}</Link><div className="small muted">{request.projectCode}</div></td>
                  <td><Badge tone={meta?.tone ?? "slate"}>{meta?.label ?? request.status}</Badge>{request.status === "FAILED" || request.status === "BLOCKED" ? <div className="small muted">{BAD_CONCLUSION_LABEL[request.status]}</div> : null}</td>
                  <td>{request.batchId ? <><Link href={`/integration/${request.batchId}`} className="archive-link">{request.batchCode} <ArrowRight size={11} /></Link><div className="small muted">{request.batchConclusion ?? "进行中"}{request.batchReportUrl ? <> · <a href={request.batchReportUrl} className="archive-link">验证报告</a></> : null}</div></> : <span className="small muted">无批次/风险发布</span>}</td>
                  <td>{request.trialFormNo ? <span className="mono small">{request.trialFormNo}</span> : <span className="small muted">—</span>}{request.riskConclusion && <div className="small muted">风险：{request.riskConclusion}</div>}</td>
                  <td>{total > 0 ? <><ProgressBar value={passed} max={total} /><span className="small muted">{passed}/{total}</span></> : <span className="small muted">—</span>}</td>
                  <td>{request.formFlowNo ? <span className="mono small">{request.formFlowNo}</span> : <span className="small muted">—</span>}</td>
                  <td className="cell-actions">{detail ? <Link href={`/trial/${request.requestId}`} className="archive-link">绑定详情 <ArrowRight size={11} /></Link> : null}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        </div>
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><div><h2 style={{ fontSize: 18 }}>集成测试批次与报告</h2><p className="small muted" style={{ marginTop: 3 }}>所有包含该版本的批次、结论和验证报告。</p></div><Badge tone="sky">{batches.length}</Badge></div>
        <div className="card-body" style={{ padding: 0, marginTop: 12 }}>
          {batches.length === 0 ? <div className="muted-panel" style={{ margin: 14 }}>该版本没有关联集成测试批次，按风险发布处理。</div> : <div className="table-wrap"><table className="data-table">
            <thead><tr><th>批次</th><th>项目</th><th>状态 / 结论</th><th>测试总结</th><th>完成时间</th><th aria-label="操作" /></tr></thead>
            <tbody>{batches.map((batch) => <tr key={batch.id}>
              <td><Link href={`/integration/${batch.id}`} style={{ fontWeight: 600 }}>{batch.code}</Link></td>
              <td>{batch.projectName}</td>
              <td><Badge tone={batch.conclusion === "PASS" ? "emerald" : batch.conclusion === "FAIL" ? "rose" : "amber"}>{batch.conclusion === "PASS" ? "测试通过" : batch.conclusion === "FAIL" ? "测试不通过" : batch.conclusion === "BLOCKED" ? "无法验证" : batch.status}</Badge></td>
              <td className="small muted" style={{ maxWidth: 420 }}>{batch.testSummary ?? "—"}</td>
              <td className="small muted">{batch.completedAt ? formatDateTime(batch.completedAt) : "—"}</td>
              <td className="cell-actions">{batch.testReportUrl ? <a href={batch.testReportUrl} className="archive-link">验证报告</a> : null}</td>
            </tr>)}</tbody>
          </table></div>}
        </div>
      </section>

      {version.status === "VOID" && (
        <div className="risk-callout" data-tone="danger" style={{ marginBottom: 14 }}>该版本已作废：{version.voidReason ?? "未填写原因"}。版本不再作为可用版本，历史转测、绑定和发布记录仍保留供追溯。</div>
      )}
      {canVoid && (
        <section className="card" style={{ marginBottom: 16 }}><div className="card-body">
          <div className="split-row" style={{ alignItems: "flex-start", gap: 12 }}>
            <div><h3 style={{ fontSize: 15 }}>作废该软件包版本</h3><p className="note" style={{ marginTop: 5 }}>作废表示该版本不再使用；全部项目记录会同步失效，历史证据保留。适用于已发试制、待转正或已转正的版本。</p></div>
            <Badge tone="rose">高风险操作</Badge>
          </div>
          <details style={{ marginTop: 12 }}><summary style={{ cursor: "pointer", color: "var(--danger)", fontSize: 12, fontWeight: 600 }}>填写作废原因</summary><div style={{ marginTop: 12, maxWidth: 620 }}>
            <ActionForm action={voidPackageVersionAction} hidden={{ versionId: version.id }} submitText="确认作废该版本" submitVariant="danger" confirmMessage="确认作废该软件包版本？全部使用项目将同步失效，且不再参与任何流程。">
              <label className="field"><span className="label">作废原因 <span className="required-mark">*</span></span><textarea className="textarea" name="reason" required minLength={5} placeholder="说明不再使用该版本的原因。" /></label>
            </ActionForm>
          </div></details>
        </div></section>
      )}

      <section className="card">
        <div className="card-header"><div><h2 style={{ fontSize: 18 }}>绑定验证证据链</h2><p className="small muted" style={{ marginTop: 3 }}>按项目展开节点、设备条码、网页电子流和审批结果。</p></div><Badge tone="teal">{details.length} 个项目</Badge></div>
        <div className="card-body" style={{ paddingTop: 12 }}>
          {details.length === 0 ? <div className="muted-panel">该版本尚未发布试制，暂无绑定验证记录。</div> : <div className="version-trace-projects">{details.map((detail) => (
            <div className="version-trace-project" key={detail.request.id}>
              <div className="toolbar" style={{ gap: 8, flexWrap: "wrap" }}>
                <span className="chip">{detail.request.projectName}</span>
                <Badge tone={detail.request.releaseMode === "RISK" ? "rose" : "violet"}>{detail.request.releaseMode === "RISK" ? "风险发布" : "集成测试通过"}</Badge>
                <span className="small muted">试制电子流 {detail.request.trialFormNo ?? "—"}</span>
                <Link href={`/trial/${detail.request.id}`} className="archive-link" style={{ marginLeft: "auto" }}>处理绑定 <ArrowRight size={11} /></Link>
              </div>
              {detail.requirements.map((requirement) => (
                <div className="version-trace-requirement" key={requirement.id}>
                  <div className="toolbar" style={{ gap: 7 }}><span className="chip">{requirement.nodeName}</span><Badge tone={requirement.status === "PASSED" ? "emerald" : "amber"}>{requirement.status === "PASSED" ? "节点通过" : "待绑定"}</Badge><span className="small muted">{requirement.approvedCount}/{requirement.requiredCount} 条码</span></div>
                  {requirement.flows.map((flow) => (
                    <div className="version-trace-flow" key={flow.id}>
                      <span className="mono small">{flow.flowNo}</span>
                      <Badge tone={flow.status === "APPROVED" ? "emerald" : flow.status === "REJECTED" ? "rose" : flow.status === "CANCELLED" ? "slate" : "amber"}>{flow.status}</Badge>
                      <span className="small muted">{flow.barcodes.length} 个条码</span>
                      {flow.webUrl && <ExternalLink href={flow.webUrl} className="flow-web-link">网页电子流</ExternalLink>}
                      <span className="small muted">审批人 {flow.approverName ?? "—"} · {flow.reviewComment ?? "待审批"}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}</div>}
        </div>
      </section>
      <div className="muted-panel" style={{ marginTop: 16 }}><Link2 size={14} style={{ display: "inline", marginRight: 5, verticalAlign: -2 }} />版本全链路记录用于质量回溯：转测申请 → 集成测试批次/结论/报告 → 试制电子流/风险结论 → 各项目节点绑定条码/电子流/审批 → 转正电子流。</div>
    </>
  );
}
