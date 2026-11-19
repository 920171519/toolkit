import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Search } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { requireWorkflowProject } from "@/lib/project-scope";
import { workflowHref } from "@/lib/workflow-links";
import { getTraceVersionRows } from "@/lib/workflow-queries";
import { EmptyState, PageHeader, StatusPill } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "版本全链路" };

const pageSize = 30;

export default async function VersionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const project = requireWorkflowProject(user, params.project);
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const requestedPackage = Number(params.package);
  const packageId = Number.isSafeInteger(requestedPackage) && requestedPackage > 0 ? requestedPackage : undefined;
  const requestedPage = Number(params.page);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const results = getTraceVersionRows(query, project?.id, packageId, pageSize + 1, (page - 1) * pageSize);
  const rows = results.slice(0, pageSize);
  const hasNextPage = results.length > pageSize;
  const listHref = (nextPage: number) => workflowHref("/versions", project?.id, {
    q: query || undefined,
    package: packageId,
    page: nextPage > 1 ? nextPage : undefined,
  });

  return (
    <>
      <PageHeader
        title="版本全链路"
        description={project
          ? `${project.name} · 查询本项目版本的转测、集成测试、试制、绑定和转正记录。`
          : "按软件包名称、编码或版本号查找版本，回看从转测到转正的记录。"}
        actions={<Link href={workflowHref("/packages", project?.id, { open: packageId })} className="button button-secondary">软件版本总览</Link>}
      />
      <section className="card">
        <div className="card-body">
          <form action="/versions" method="get" className="toolbar" style={{ alignItems: "flex-end", gap: 10, flexWrap: "wrap" }}>
            {project && <input type="hidden" name="project" value={project.id} />}
            {packageId && <input type="hidden" name="package" value={packageId} />}
            <label className="field" style={{ flex: "1 1 220px", maxWidth: 380 }}>
              <span className="label">软件包或版本</span>
              <input className="input" name="q" defaultValue={query} maxLength={100} placeholder="例如 1001OTA 1.6.0" />
            </label>
            <button type="submit" className="button button-primary"><Search size={14} />搜索</button>
            {packageId && <Link href={workflowHref("/versions", project?.id)} className="button button-secondary">全部软件包</Link>}
          </form>
        </div>
        {rows.length === 0 ? (
          <EmptyState title="未找到版本" description="可以调整搜索关键词或回到第 1 页。" />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>软件包</th><th>版本</th><th>版本状态</th><th>提交时间</th><th aria-label="操作" /></tr></thead>
              <tbody>
                {rows.map((row) => {
                  const href = workflowHref(`/versions/${row.id}`, project?.id);
                  return (
                    <tr key={row.id}>
                      <td><strong>{row.packageName}</strong><div className="small muted">{row.packageCode}</div></td>
                      <td><Link href={href} className="version-badge">{row.version}</Link></td>
                      <td><StatusPill status={row.status} /></td>
                      <td className="small muted">{formatDateTime(row.submittedAt)}</td>
                      <td className="cell-actions"><Link href={href} className="archive-link">全链路追溯 <ArrowRight size={11} /></Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {(page > 1 || hasNextPage) && (
          <nav aria-label="版本列表分页" className="card-body toolbar" style={{ justifyContent: "flex-end", gap: 10 }}>
            {page > 1 && <Link href={listHref(page - 1)} className="button button-secondary button-sm">上一页</Link>}
            <span className="small muted">第 {page} 页</span>
            {hasNextPage && <Link href={listHref(page + 1)} className="button button-secondary button-sm">下一页</Link>}
          </nav>
        )}
      </section>
    </>
  );
}
