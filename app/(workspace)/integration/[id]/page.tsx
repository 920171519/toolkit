import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ClipboardCheck, FileText, GitBranch, ShieldAlert } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { canManageProjectWorkflow } from "@/lib/permissions";
import { canSubmitIntegrationConclusionForProject } from "@/lib/access";
import { parseFlash } from "@/lib/queries";
import { getBatchDetail } from "@/lib/workflow-queries";
import { formatDateTime } from "@/lib/format";
import { ATTRIBUTION_META, CONCLUSION_META } from "@/lib/constants";
import { completeBatchAction, deleteDraftBatchAction, sendBatchAction, terminateBatchAction } from "@/lib/actions/workflow";
import { ActionForm } from "@/components/action-form";
import { Badge, BatchStatusPill, ExternalLink, FlashMessage, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "转测批次详情" };

export default async function BatchDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const batchId = Number(id);
  if (!Number.isInteger(batchId)) notFound();
  const data = getBatchDetail(batchId);
  if (!data) notFound();
  const search = await searchParams;
  const notice = parseFlash(search.flash, search.tone === "error" ? "error" : "success");
  const { batch, items } = data;
  const manager = canManageProjectWorkflow(user, batch.softwareManagerId);
  const canTest = canSubmitIntegrationConclusionForProject(user, batch.projectId);
  const changedItems = items.filter((item) => item.isChanged);

  return (
    <>
      <PageHeader
        eyebrow="Integration / Batch detail"
        title={`${batch.code} · ${batch.projectName ?? "未指定项目"}`}
        description={<>{batch.title} · 发起人 {batch.createdByName ?? "系统"} · {formatDateTime(batch.sentAt ?? batch.createdAt)} · {batch.changedCount} 个变更包 / {batch.itemCount} 个配套包</>}
        actions={<><Link href="/integration" className="button button-secondary"><ArrowLeft size={14} />返回列表</Link><BatchStatusPill status={batch.status as "DRAFT" | "IN_TEST" | "COMPLETED" | "TERMINATED"} /></>}
      />
      <FlashMessage notice={notice} />

      <div className="info-strip" style={{ marginBottom: 18 }}>
        <span>项目 <strong>{batch.projectName ?? "—"}</strong></span>
        <span>批次状态 <strong><BatchStatusPill status={batch.status as "DRAFT" | "IN_TEST" | "COMPLETED" | "TERMINATED"} /></strong></span>
        <span>配套 <strong>{batch.itemCount}</strong></span>
        <span>变更 <strong>{batch.changedCount}</strong></span>
        {batch.conclusion && <span>结论 <strong>{CONCLUSION_META[batch.conclusion as keyof typeof CONCLUSION_META]?.label ?? batch.conclusion}</strong></span>}
      </div>

      <div className="two-col">
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <section className="card">
            <div className="card-header"><div><h2 style={{ fontSize: 18 }}>配套版本快照</h2><p className="small muted" style={{ marginTop: 3 }}>记录当前正式版本、当前试制版本、本次转测版本，以及与该项目上一次转测相比是否有变更。</p></div></div>
            <div className="card-body" style={{ padding: 0, marginTop: 13 }}>
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>软件包</th><th>正式版本</th><th>试制版本</th><th>上次转测</th><th>本次转测</th><th>归档地址</th><th>变更</th></tr></thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.id}>
                        <td><Link href={`/packages?open=${item.packageId}`} style={{ fontWeight: 600 }}>{item.packageName}</Link><div className="small muted">{item.packageCode} · {item.ownerName ?? "责任人待定"}</div></td>
                        <td><span className="mono small">{item.formalVersion ?? "—"}</span></td>
                        <td><span className="mono small">{item.trialVersions || "—"}</span></td>
                        <td><span className="mono small">{item.previousTestVersion ?? "首次"}</span></td>
                        <td><span className="version-badge">{item.version}</span>{item.isChanged && <div><Badge tone="amber">本次变更包</Badge></div>}</td>
                        <td><ExternalLink href={item.archiveUrl}>归档包</ExternalLink></td>
                        <td>{!item.previousTestVersion ? <Badge tone="slate">首次转测</Badge> : item.changedVsPrevious ? <Badge tone="violet">有变更</Badge> : <Badge tone="slate">无变化</Badge>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {changedItems.length > 0 && (
            <div className="muted-panel">
              {changedItems.map((item) => `${item.packageName} ${item.version}`).join("、")} 为本批次变更包。测试结论只回写这些包在本项目下的转测申请。
            </div>
          )}
        </div>

        <aside style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {batch.status === "DRAFT" && manager && (
            <section className="card">
              <div className="card-header"><div><div className="eyebrow">Ready to send</div><h2 style={{ fontSize: 17, marginTop: 5 }}>确认发起转测</h2></div><GitBranch size={18} style={{ color: "var(--brand)" }} /></div>
              <div className="card-body" style={{ paddingTop: 14 }}>
                <p className="note" style={{ marginBottom: 12 }}>发起后，本批次变更版本在 {batch.projectName} 项目下进入集成测试。不同项目或同项目的其他批次可以同时测试。</p>
                <ActionForm action={sendBatchAction} hidden={{ batchId: batch.id }} submitText="发起转测" confirmMessage={`确认将 ${batch.code} 发起集成测试？`} />
                <div style={{ borderTop: "1px solid var(--line)", marginTop: 16, paddingTop: 14 }}>
                  <ActionForm action={deleteDraftBatchAction} hidden={{ batchId: batch.id }} submitText="删除草稿" submitVariant="outline-danger" submitClassName="button-sm" confirmMessage="确认删除这个转测草稿？" />
                </div>
              </div>
            </section>
          )}

          {batch.status === "IN_TEST" && canTest && (
            <section className="card">
              <div className="card-header"><div><div className="eyebrow">Test conclusion</div><h2 style={{ fontSize: 17, marginTop: 5 }}>提交项目测试结论</h2></div><ClipboardCheck size={18} style={{ color: "var(--info)" }} /></div>
              <div className="card-body" style={{ paddingTop: 14 }}>
                <ActionForm action={completeBatchAction} testId="complete-test-form" hidden={{ batchId: batch.id }} submitText="提交验证结论">
                  <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
                    <label className="field"><span className="label">测试结论</span><select className="select" name="conclusion" defaultValue="PASS"><option value="PASS">测试通过</option><option value="FAIL">测试不通过</option><option value="BLOCKED">无法完成验证</option></select></label>
                    <label className="field"><span className="label">问题归属</span><select className="select" name="issueAttribution" defaultValue="NONE"><option value="NONE">未发现问题</option><option value="PACKAGE_RELATED">问题与软件包相关</option><option value="NOT_PACKAGE_RELATED">问题与软件包无关</option><option value="UNKNOWN">原因待定位 / 无测试条件</option></select></label>
                    <label className="field"><span className="label">测试总结</span><textarea className="textarea" name="testSummary" required minLength={10} placeholder="说明本项目验证范围、通过情况与问题定位。" /></label>
                    <label className="field"><span className="label">验证报告 <span className="required-mark">*</span><span className="hint">PDF / 图片 / Word / Excel / TXT / ZIP，≤15MB</span></span><input className="input" name="reportFile" type="file" required accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.txt,.zip" /></label>
                  </div>
                </ActionForm>
                <p className="page-footnote">本结论只影响当前项目及其转测申请；其他项目可并行继续测试。测试结论必须上传验证报告，非通过结论会在提交人的个人工作台出现异常提醒。</p>
              </div>
            </section>
          )}

          {batch.status === "IN_TEST" && manager && (
            <section className="card"><div className="card-header"><div><h2 style={{ fontSize: 16 }}>终止本轮测试</h2></div></div><div className="card-body" style={{ paddingTop: 12 }}>
              <details><summary style={{ cursor: "pointer", color: "var(--danger)", fontSize: 12, fontWeight: 600 }}>填写原因并终止</summary><div style={{ marginTop: 12 }}>
                <ActionForm action={terminateBatchAction} testId="terminate-batch-form" hidden={{ batchId: batch.id }} submitText="确认终止测试" submitVariant="danger" confirmMessage="终止后，本批次变更版本在该项目下退回待转测。确认继续？">
                  <label className="field"><span className="label">终止原因</span><textarea className="textarea" name="reason" required minLength={8} placeholder="说明终止原因和后续安排。" /></label>
                </ActionForm>
              </div></details>
            </div></section>
          )}

          {batch.status === "COMPLETED" && (
            <section className="card">
              <div className="card-header"><div><div className="eyebrow">Test result</div><h2 style={{ fontSize: 17, marginTop: 5 }}>验证结论</h2></div>{batch.conclusion && <Badge tone={CONCLUSION_META[batch.conclusion as keyof typeof CONCLUSION_META]?.tone ?? "slate"}>{CONCLUSION_META[batch.conclusion as keyof typeof CONCLUSION_META]?.label ?? batch.conclusion}</Badge>}</div>
              <div className="card-body" style={{ paddingTop: 14 }}>
                {batch.issueAttribution && <Badge tone={ATTRIBUTION_META[batch.issueAttribution as keyof typeof ATTRIBUTION_META]?.tone ?? "slate"}>{ATTRIBUTION_META[batch.issueAttribution as keyof typeof ATTRIBUTION_META]?.label ?? batch.issueAttribution}</Badge>}
                <p className="change-copy" style={{ marginTop: 12 }}>{batch.testSummary}</p>
                {batch.testReportUrl && <div style={{ marginTop: 12 }}><ExternalLink href={batch.testReportUrl}><FileText size={12} /> {batch.testReportName ?? "测试验证报告"}</ExternalLink></div>}
                {batch.conclusion !== "PASS" && <div className="risk-callout" style={{ marginTop: 14 }}><ShieldAlert size={14} style={{ display: "inline", marginRight: 5, verticalAlign: -2 }} />本批次非测试通过结论，请关注提交人工作台中的异常提醒。</div>}
              </div>
            </section>
          )}

          {batch.status === "TERMINATED" && (
            <section className="card"><div className="card-header"><div><h2 style={{ fontSize: 17 }}>测试已终止</h2></div><Badge tone="rose">已终止</Badge></div><div className="card-body" style={{ paddingTop: 12 }}><div className="detail-row"><dt>终止时间</dt><dd>{formatDateTime(batch.terminatedAt)}</dd></div><div className="risk-callout" data-tone="danger" style={{ marginTop: 12 }}>{batch.terminateReason ?? "未填写终止原因"}</div></div></section>
          )}

          <section className="card card-muted"><div className="card-body"><h3 style={{ fontSize: 13 }}>项目测试提示</h3><p className="note" style={{ marginTop: 7 }}>不同项目的软件包配套和测试批次相互独立。一个项目测试未结束时，仍可为同一软件包提交新版本或为其他项目安排测试。</p><div style={{ marginTop: 8 }}><Link href="/submissions" className="archive-link">查看按项目分发的转测申请</Link></div></div></section>
        </aside>
      </div>
    </>
  );
}
