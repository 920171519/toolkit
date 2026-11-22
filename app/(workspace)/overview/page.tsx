import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ColumnFilterHeader } from "@/components/column-filter-header";
import { DirectoryFilterBar, DirectoryPagination } from "@/components/settings-directory";
import { EmptyState, FlashMessage, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { filterOptions, matchesChoiceFilter, matchesTextFilter, readColumnFilters, type ColumnFilterField } from "@/lib/column-filters";
import { DEFAULT_LIST_PAGE_SIZE, getListPageSize } from "@/lib/list-pagination";
import { getProjectStage, PROJECT_STAGE_META, PROJECT_STAGES } from "@/lib/project-stage";
import { getProjectCatalog, parseFlash, type ProjectContact } from "@/lib/queries";
import { directoryHref, directoryPage, matchesDirectorySearch } from "@/lib/settings-directory";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "项目总览" };

const path = "/overview";
const unassigned = { value: "empty", label: "待指定" };
const projectFields: ColumnFilterField[] = [
  { key: "name", label: "项目名称", kind: "text" },
  { key: "code", label: "项目编码", kind: "text" },
];
const stageField: ColumnFilterField = {
  key: "stage",
  label: "阶段",
  kind: "choices",
  options: PROJECT_STAGES.map((stage) => ({ value: stage, label: PROJECT_STAGE_META[stage].label })),
};

function contactOptions(contacts: ProjectContact[]) {
  return [...filterOptions(contacts.map((person) => ({ value: String(person.id), label: person.name }))), unassigned];
}

function contactValues(contacts: ProjectContact[]) {
  return contacts.length ? contacts.map((person) => String(person.id)) : [unassigned.value];
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
  const pageSize = getListPageSize(params.pageSize);
  const catalog = getProjectCatalog();
  const pmField: ColumnFilterField = {
    key: "pm",
    label: "PM",
    kind: "choices",
    options: contactOptions(catalog.flatMap((project) => project.pms)),
  };
  const managerField: ColumnFilterField = {
    key: "manager",
    label: "软件经理",
    kind: "choices",
    options: contactOptions(catalog.flatMap((project) => project.softwareManagers)),
  };
  const columnFilters = readColumnFilters(
    { ...params, f_stage: params.f_stage ?? PROJECT_STAGES.find((stage) => stage === params.stage) },
    [...projectFields, stageField, pmField, managerField],
  );
  const projects = catalog.filter((project) =>
    matchesTextFilter(columnFilters, "name", project.name)
    && matchesTextFilter(columnFilters, "code", project.code)
    && matchesChoiceFilter(columnFilters, "stage", [getProjectStage(project.status, project.stage)])
    && matchesChoiceFilter(columnFilters, "pm", contactValues(project.pms))
    && matchesChoiceFilter(columnFilters, "manager", contactValues(project.softwareManagers))
    && matchesDirectorySearch(
      query,
      project.name,
      project.code,
      ...[...project.pms, ...project.softwareManagers].map((person) => person.name),
    ),
  );
  const { items, page, pages, total } = directoryPage(projects, params.page, pageSize);
  const listParams = {
    ...columnFilters,
    q: query || undefined,
    pageSize: pageSize === DEFAULT_LIST_PAGE_SIZE ? undefined : String(pageSize),
    page: page > 1 ? String(page) : undefined,
  };
  const overviewQuery = directoryHref(path, listParams).split("?")[1];
  const filtered = Boolean(query || Object.keys(columnFilters).length);

  return (
    <>
      <PageHeader title="项目总览" />
      <FlashMessage notice={notice} />
      <section className="card" aria-label="项目列表">
        <DirectoryFilterBar path={path} params={listParams} />
        <div className="table-wrap" role="region" tabIndex={0} aria-label="项目表格">
          <table className="data-table project-overview-table">
            <thead>
              <tr>
                <ColumnFilterHeader label="项目" path={path} params={listParams} fields={projectFields} />
                <ColumnFilterHeader label="阶段" path={path} params={listParams} fields={[stageField]} />
                <ColumnFilterHeader label="PM" path={path} params={listParams} fields={[pmField]} />
                <ColumnFilterHeader label="软件经理" path={path} params={listParams} fields={[managerField]} />
              </tr>
            </thead>
            <tbody>
              {items.map((project) => (
                <tr key={project.id} className="project-overview-row">
                  <td>
                    <Link href={directoryHref("/projects/" + project.id, { overviewQuery })} className="project-overview-name" prefetch={false}>
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
        {items.length === 0 && <EmptyState title={filtered ? "没有匹配的项目" : "暂无项目"} />}
        <DirectoryPagination path={path} params={listParams} page={page} pages={pages} total={total} unit="个项目" pageSize={pageSize} label="项目分页" />
      </section>
    </>
  );
}
