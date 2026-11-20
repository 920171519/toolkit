import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Search } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getListPageSize, LIST_PAGE_SIZES } from "@/lib/list-pagination";
import { getProjectStage, PROJECT_STAGE_META, PROJECT_STAGES } from "@/lib/project-stage";
import { getProjectCatalog, parseFlash } from "@/lib/queries";
import { EmptyState, FlashMessage, PageHeader } from "@/components/ui";
import styles from "./overview.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "项目总览" };

function normalize(value: string) {
  return value.normalize("NFKC").toLowerCase();
}

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const params = await searchParams;
  const notice = parseFlash(params.flash, params.tone === "error" ? "error" : "success");
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  const selectedStage = PROJECT_STAGES.find((stage) => stage === params.stage);
  const pageSize = getListPageSize(params.pageSize);
  const projects = getProjectCatalog().filter((project) => {
    if (selectedStage && getProjectStage(project.status, project.stage) !== selectedStage) return false;
    const text = normalize([
      project.name,
      project.code,
      ...[...project.pms, ...project.softwareManagers].map((person) => person.name),
    ].join(" "));
    return terms.every((term) => text.includes(term));
  });
  const lastPage = Math.max(1, Math.ceil(projects.length / pageSize));
  const requestedPage = typeof params.page === "string" ? Number(params.page) : 1;
  const page = Number.isSafeInteger(requestedPage) ? Math.max(1, Math.min(requestedPage, lastPage)) : 1;
  const pageRows = projects.slice((page - 1) * pageSize, page * pageSize);

  function pageHref(target: number) {
    const search = new URLSearchParams({ pageSize: String(pageSize) });
    if (query) search.set("q", query);
    if (selectedStage) search.set("stage", selectedStage);
    if (target > 1) search.set("page", String(target));
    return "/overview?" + search.toString();
  }

  return (
    <>
      <PageHeader title="项目总览" />
      <FlashMessage notice={notice} />
      <section className="card" aria-label="项目列表">
        <form className={styles.filters} action="/overview" method="get" role="search" aria-label="查找项目">
          <label className={styles.search}>
            <span className="label">搜索项目</span>
            <input className="input" type="search" name="q" defaultValue={query} maxLength={100} placeholder="项目名称、编码或联系人" />
          </label>
          <div>
            <label className="label" htmlFor="overview-project-stage">项目阶段</label>
            <select className="select" id="overview-project-stage" name="stage" defaultValue={selectedStage ?? ""}>
              <option value="">全部阶段</option>
              {PROJECT_STAGES.map((stage) => <option key={stage} value={stage}>{PROJECT_STAGE_META[stage].label}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="overview-page-size">每页条数</label>
            <select className="select" id="overview-page-size" name="pageSize" defaultValue={pageSize}>
              {LIST_PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </div>
          <button type="submit" className="button button-primary"><Search size={15} aria-hidden="true" />查询</button>
          {(query || selectedStage) && <Link href={"/overview?pageSize=" + pageSize} className="button button-ghost" prefetch={false}>清除筛选</Link>}
        </form>
        {pageRows.length > 0 ? (
          <div className="table-wrap" role="region" tabIndex={0} aria-label="项目表格">
            <table className="data-table project-overview-table">
              <thead><tr><th scope="col">项目</th><th scope="col">阶段</th><th scope="col">PM</th><th scope="col">软件经理</th></tr></thead>
              <tbody>
                {pageRows.map((project) => (
                  <tr key={project.id} className="project-overview-row">
                    <td>
                      <Link href={"/projects/" + project.id} className="project-overview-name" prefetch={false}>
                        {project.name}<ArrowRight size={13} aria-hidden="true" />
                      </Link>
                      <div className="small muted">{project.code}</div>
                    </td>
                    <td>{PROJECT_STAGE_META[getProjectStage(project.status, project.stage)].label}</td>
                    <td>{project.pms.map((person) => person.name).join("、") || "待指定"}</td>
                    <td>{project.softwareManagers.map((person) => person.name).join("、") || "待指定"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title={query || selectedStage ? "没有匹配的项目" : "暂无项目"} />
        )}
        <div className={styles.footer}>
          <span className="small muted">{projects.length} 个项目</span>
          {lastPage > 1 && (
            <nav className={styles.pagination} aria-label="项目分页">
              {page > 1 && <Link href={pageHref(page - 1)} className="button button-secondary button-sm" prefetch={false}>上一页</Link>}
              <span>第 {page} / {lastPage} 页</span>
              {page < lastPage && <Link href={pageHref(page + 1)} className="button button-secondary button-sm" prefetch={false}>下一页</Link>}
            </nav>
          )}
        </div>
      </section>
    </>
  );
}
