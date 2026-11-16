import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { parseFlash } from "@/lib/queries";
import { getBatches, getWorkflowProjectScope } from "@/lib/workflow-queries";
import { formatDateTime } from "@/lib/format";
import { Badge, BatchStatusPill, EmptyState, FlashMessage, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "集成测试" };

const conclusionLabel: Record<string, string> = { PASS: "测试通过", FAIL: "测试不通过", BLOCKED: "无法完成验证" };

export default async function IntegrationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const notice = parseFlash(params.flash, params.tone === "error" ? "error" : "success");
  const batches = getBatches(200, getWorkflowProjectScope(user));
  const active = batches.filter((batch) => batch.status === "IN_TEST");
  const history = batches.filter((batch) => batch.status !== "IN_TEST" && batch.status !== "DRAFT");
  const projects = new Set(active.map((batch) => batch.projectId));

  return (
    <>
      <PageHeader
        eyebrow="Integration / In test"
        title="集成测试"
        description="这里只关注已发起、正在进行的项目集成测试批次。待测申请、版本调整和待发起批次请到待转测申请页处理。"
        actions={<Link href="/submissions" className="button button-primary">待转测申请 <ArrowRight size={14} /></Link>}
      />
      <FlashMessage notice={notice} />
      <div className="info-strip" style={{ marginBottom: 16 }}>
        <span><strong>{active.length}</strong> 个批次正在测试</span>
        <span>覆盖 <strong>{projects.size}</strong> 个项目</span>
        <span>集成测试结论由本项目测试负责人提交并上传报告</span>
        <span style={{ marginLeft: "auto" }}>待发起批次请到待转测申请页</span>
      </div>

      <section className="card">
        <div className="card-header"><div><h2 style={{ fontSize: 18 }}>当前在测批次</h2><p className="small muted" style={{ marginTop: 3 }}>每个批次只针对一个项目，包含本项目整套软件包快照。</p></div><Badge tone="sky">{active.length} 个进行中</Badge></div>
        <div className="card-body" style={{ paddingTop: 12 }}>
          {active.length === 0 ? (
            <EmptyState title="当前没有集成测试中的批次" description="在待转测申请页发起整套配套转测后，批次会出现在这里。" />
          ) : (
            <div className="three-col">
              {active.map((batch) => (
                <article className="card" key={batch.id} style={{ padding: 16 }}>
                  <div className="split-row"><div className="toolbar" style={{ gap: 7 }}><span className="mono" style={{ fontSize: 15, fontWeight: 700 }}>{batch.code}</span><BatchStatusPill status="IN_TEST" /></div><span className="chip">{batch.projectName}</span></div>
                  <div style={{ marginTop: 7, fontSize: 13, fontWeight: 600 }}>{batch.title}</div>
                  <div className="small muted" style={{ marginTop: 3 }}>{formatDateTime(batch.sentAt)} 发起 · {batch.changedCount} 个变更包 / {batch.itemCount} 个配套包</div>
                  <div style={{ marginTop: 12 }}><Link href={`/integration/${batch.id}`} className="archive-link">查看批次并提交测试结论 <ArrowRight size={11} /></Link></div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      {history.length > 0 && (
        <details className="card history-collapsible" style={{ marginTop: 16 }}>
          <summary><span>历史批次记录</span><Badge tone="slate">{history.length}</Badge></summary>
          <div className="card-body" style={{ padding: 0, marginTop: 4 }}>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>批次</th><th>项目</th><th>状态</th><th>配套 / 变更</th><th>结论</th><th>时间</th><th aria-label="操作" /></tr></thead>
                <tbody>{history.map((batch) => (
                  <tr key={batch.id}>
                    <td><Link href={`/integration/${batch.id}`} style={{ fontWeight: 600 }}>{batch.code}</Link><div className="small muted">{batch.title}</div></td>
                    <td><span className="chip">{batch.projectName}</span></td>
                    <td><BatchStatusPill status={batch.status as "COMPLETED" | "TERMINATED"} /></td>
                    <td><span className="mono small">{batch.itemCount} / {batch.changedCount}</span></td>
                    <td>{batch.conclusion ? <Badge tone={batch.conclusion === "PASS" ? "emerald" : batch.conclusion === "FAIL" ? "rose" : "amber"}>{conclusionLabel[batch.conclusion] ?? batch.conclusion}</Badge> : <span className="small muted">已终止</span>}</td>
                    <td className="small muted">{formatDateTime(batch.completedAt ?? batch.terminatedAt ?? batch.sentAt ?? batch.createdAt)}</td>
                    <td className="cell-actions"><Link href={`/integration/${batch.id}`} className="archive-link">查看</Link></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        </details>
      )}
    </>
  );
}
