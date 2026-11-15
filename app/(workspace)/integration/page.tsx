import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, FlaskConical, Layers3 } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { canManageWorkflow } from "@/lib/permissions";
import { parseFlash } from "@/lib/queries";
import { getBatches, getPendingTransferGroups, getProjectOptions, getWorkflowProjectScope } from "@/lib/workflow-queries";
import { formatDateTime } from "@/lib/format";
import { Badge, BatchStatusPill, EmptyState, FlashMessage, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "集成测试" };

const conclusionLabel: Record<string, string> = {
  PASS: "测试通过",
  FAIL: "测试不通过",
  BLOCKED: "无法完成验证",
};

export default async function IntegrationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const notice = parseFlash(params.flash, params.tone === "error" ? "error" : "success");
  const scope = getWorkflowProjectScope(user);
  const batches = getBatches(200, scope);
  const active = batches.filter((batch) => batch.status === "IN_TEST");
  const pendingGroups = getPendingTransferGroups(scope);
  const projects = scope === null ? getProjectOptions() : getProjectOptions().filter((project) => scope.includes(project.id));
  const manager = canManageWorkflow(user) || user.role === "ADMIN";

  return (
    <>
      <PageHeader
        eyebrow="Integration / By project"
        title="集成测试"
        description="集成测试以项目为单位运行。每个项目拥有独立的软件包配套，多台测试设备可同时测试多个项目或多个批次。"
        actions={manager ? <Link href="/integration/new" className="button button-primary"><FlaskConical size={14} />为项目组织转测</Link> : <Link href="/packages" className="button button-secondary">查看版本总览</Link>}
      />
      <FlashMessage notice={notice} />

      <div className="info-strip" style={{ marginBottom: 18 }}>
        <span><strong>{active.length}</strong> 个批次测试中</span>
        <span><strong>{pendingGroups.reduce((sum, group) => sum + group.items.length, 0)}</strong> 个项目转测申请待安排</span>
        <span>共 {projects.length} 个在行项目可独立安排</span>
        <span style={{ marginLeft: "auto" }}>多个批次可并行测试</span>
      </div>

      <section className="card" style={{ marginBottom: 18 }}>
        <div className="card-header">
          <div><h2 style={{ fontSize: 18 }}>测试中的项目批次</h2><p className="small muted" style={{ marginTop: 3 }}>每个批次只针对一个项目，包含该项目的完整配套快照。</p></div>
          <Badge tone="sky">{active.length} 个进行中</Badge>
        </div>
        <div className="card-body" style={{ paddingTop: 12 }}>
          {active.length === 0 ? (
            <EmptyState title="当前没有集成测试中的批次" description="软件经理可以从各项目的待转测申请中组织配套。" />
          ) : (
            <div className="three-col">
              {active.map((batch) => (
                <article className="card" key={batch.id} style={{ padding: 16 }}>
                  <div className="split-row">
                    <div className="toolbar" style={{ gap: 7 }}>
                      <span className="mono" style={{ fontSize: 15, fontWeight: 700 }}>{batch.code}</span>
                      <BatchStatusPill status="IN_TEST" />
                    </div>
                    <span className="chip">{batch.projectName}</span>
                  </div>
                  <div style={{ marginTop: 7, fontSize: 13, fontWeight: 600 }}>{batch.title}</div>
                  <div className="small muted" style={{ marginTop: 3 }}>{formatDateTime(batch.sentAt)} 发起 · {batch.changedCount} 个变更包 / {batch.itemCount} 个配套包</div>
                  <div style={{ marginTop: 12 }}>
                    <Link href={`/integration/${batch.id}`} className="archive-link">查看并填写测试结论 <ArrowRight size={11} /></Link>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      {pendingGroups.length > 0 && (
        <section className="card" style={{ marginBottom: 18 }}>
          <div className="card-header">
            <div><h2 style={{ fontSize: 17 }}>待安排转测的项目</h2><p className="small muted" style={{ marginTop: 3 }}>只需要从某个项目进入，即可挑选该项目待测的软件包版本。</p></div>
            <Layers3 size={16} style={{ color: "var(--muted-light)" }} />
          </div>
          <div className="card-body" style={{ paddingTop: 10 }}>
            <div className="three-col">
              {pendingGroups.map((group) => (
                <div className="inset-panel" key={group.projectId}>
                  <div className="split-row">
                    <div className="toolbar" style={{ gap: 7 }}><span className="chip">{group.projectCode}</span><strong style={{ fontSize: 13 }}>{group.projectName}</strong></div>
                    <Badge tone="amber">{group.items.length}</Badge>
                  </div>
                  <div className="small muted" style={{ marginTop: 6 }}>{group.items.slice(0, 3).map((item) => `${item.packageName} ${item.version}`).join("、")}</div>
                  {manager && <Link href={`/integration/new?project=${group.projectId}`} className="archive-link" style={{ marginTop: 9 }}>组织该项目转测 <ArrowRight size={11} /></Link>}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-header"><div><h2 style={{ fontSize: 18 }}>批次记录</h2><p className="small muted" style={{ marginTop: 3 }}>按项目保留每轮配套、测试结论、终止原因和版本快照。</p></div><Badge tone="slate">{batches.length}</Badge></div>
        <div className="card-body" style={{ padding: 0, marginTop: 12 }}>
          {batches.length === 0 ? (
            <EmptyState title="暂无转测批次" description="第一轮转测发起后，批次记录会显示在这里。" />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>批次</th><th>项目</th><th>状态</th><th>配套 / 变更</th><th>测试结论</th><th>时间</th><th aria-label="操作" /></tr></thead>
                <tbody>
                  {batches.map((batch) => (
                    <tr key={batch.id}>
                      <td><Link href={`/integration/${batch.id}`} style={{ fontWeight: 600 }}>{batch.code}</Link><div className="small muted">{batch.title}</div></td>
                      <td><span className="chip">{batch.projectName ?? "—"}</span></td>
                      <td><BatchStatusPill status={batch.status as "DRAFT" | "IN_TEST" | "COMPLETED" | "TERMINATED"} /></td>
                      <td><span className="mono small">{batch.itemCount} / {batch.changedCount}</span><div className="small muted">配套包 / 变更包</div></td>
                      <td>{batch.conclusion ? <Badge tone={batch.conclusion === "PASS" ? "emerald" : batch.conclusion === "FAIL" ? "rose" : "amber"}>{conclusionLabel[batch.conclusion] ?? batch.conclusion}</Badge> : batch.status === "TERMINATED" ? <span className="small muted">已终止</span> : <span className="small muted">等待中</span>}</td>
                      <td className="small muted">{formatDateTime(batch.sentAt ?? batch.createdAt)}</td>
                      <td className="cell-actions"><Link href={`/integration/${batch.id}`} className="archive-link">查看 <ArrowRight size={12} /></Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
