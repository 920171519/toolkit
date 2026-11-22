import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ChevronDown } from "lucide-react";
import { ColumnFilterHeader } from "@/components/column-filter-header";
import { DirectoryFilterBar, DirectoryPagination } from "@/components/settings-directory";
import { requireUser } from "@/lib/auth";
import { filterOptions } from "@/lib/column-filters";
import { requireWorkflowProject } from "@/lib/project-scope";
import { parseFlash } from "@/lib/queries";
import { workflowHref } from "@/lib/workflow-links";
import { getBatches, getIntegrationHistoryPage, getProjectOptions, getWorkflowProjectScope } from "@/lib/workflow-queries";
import { historyFields, historyStatuses, integrationHistoryParams, readIntegrationHistory } from "@/lib/integration-history";
import { formatDateTime } from "@/lib/format";
import { Badge, BatchStatusPill, EmptyState, FlashMessage, PageHeader } from "@/components/ui";
import styles from "./history.module.css";

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
  const project = requireWorkflowProject(user, params.project);
  const scope = project ? [project.id] : getWorkflowProjectScope(user);
  const active = getBatches(200, scope, "IN_TEST");
  const historyState = readIntegrationHistory(params);
  const history = getIntegrationHistoryPage(historyState, scope);
  const historyParams = integrationHistoryParams({ ...historyState, page: history.page });
  const listParams = { project: project ? String(project.id) : undefined, ...historyParams };
  const filterHeader = { path: "/integration", params: listParams };
  const projectOptions = project ? [project] : getProjectOptions(true).filter(({ id }) => scope === null || scope.includes(id));
  const projectField = { ...historyFields.project, options: filterOptions(projectOptions.map(({ id, name }) => ({ value: String(id), label: name }))) };
  const projects = new Set(active.map((batch) => batch.projectId));

  return (
    <>
      <PageHeader
        eyebrow="Integration / In test"
        title="集成测试"
        description={project ? `${project.name} · 查看本项目的在测批次和历史批次。` : "查看正在进行的集成测试批次和历史记录，到待转测申请页准备配套版本并发起转测。"}
        actions={<Link href={workflowHref("/submissions", project?.id)} className="button button-primary">待转测申请 <ArrowRight size={14} /></Link>}
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
                  <div style={{ marginTop: 12 }}><Link href={workflowHref(`/integration/${batch.id}`, project?.id)} className="archive-link">查看批次并提交测试结论 <ArrowRight size={11} /></Link></div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      <details id="integration-history" className={`card ${styles.history}`} open={historyState.open}>
        <summary className={styles.summary}>
          <ChevronDown size={16} aria-hidden="true" />
          <span>历史批次记录</span>
          <Badge tone="slate">{history.total}</Badge>
        </summary>
        <DirectoryFilterBar {...filterHeader} />
        <div className="table-wrap" tabIndex={0} role="region" aria-label="历史批次表格">
          <table className="data-table">
            <thead><tr>
              <ColumnFilterHeader {...filterHeader} label="批次" fields={[historyFields.batch, historyFields.title]} />
              <ColumnFilterHeader {...filterHeader} label="项目" fields={[projectField]} />
              <ColumnFilterHeader {...filterHeader} label="状态" fields={[historyFields.status]} />
              <ColumnFilterHeader {...filterHeader} label="配套 / 变更" fields={[historyFields.items, historyFields.changed]} numeric />
              <ColumnFilterHeader {...filterHeader} label="结论" fields={[historyFields.conclusion]} />
              <ColumnFilterHeader {...filterHeader} label="时间" fields={[historyFields.date]} />
              <th scope="col" aria-label="操作" />
            </tr></thead>
            <tbody>{history.rows.map((batch) => {
              const detailHref = workflowHref(`/integration/${batch.id}`, project?.id, historyParams);
              return (
                  <tr key={batch.id}>
                    <td><Link href={detailHref} className="archive-link mono" prefetch={false}>{batch.code}</Link><div className="small muted">{batch.title}</div></td>
                    <td><span className="chip">{batch.projectName}</span></td>
                    <td><BatchStatusPill status={batch.status as (typeof historyStatuses)[number]} /></td>
                    <td className="cell-actions"><span className="mono small">{batch.itemCount} / {batch.changedCount}</span></td>
                    <td>{batch.conclusion ? <Badge tone={batch.conclusion === "PASS" ? "emerald" : batch.conclusion === "FAIL" ? "rose" : "amber"}>{conclusionLabel[batch.conclusion] ?? batch.conclusion}</Badge> : <span className="small muted">无测试结论</span>}</td>
                    <td className="small muted">{formatDateTime(batch.completedAt ?? batch.terminatedAt ?? batch.sentAt ?? batch.createdAt)}</td>
                    <td className="cell-actions"><Link href={detailHref} className="archive-link" prefetch={false}>查看</Link></td>
                  </tr>
              );
            })}</tbody>
          </table>
        </div>
        {history.rows.length === 0 && <EmptyState title={Object.keys(historyState.filters).length ? "没有匹配的历史批次" : "暂无历史批次"} />}
        <DirectoryPagination {...filterHeader} page={history.page} pages={history.pages} total={history.total} unit="个批次" pageSize={historyState.pageSize} label="历史批次分页" />
      </details>
    </>
  );
}
