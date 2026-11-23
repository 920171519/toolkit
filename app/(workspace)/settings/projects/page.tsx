import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { getPeople, getProjectConfigs, parseFlash } from "@/lib/queries";
import { saveProjectAction } from "@/lib/actions/settings";
import { PROJECT_STATUS_META } from "@/lib/constants";
import { getProjectStage, PROJECT_STAGE_META } from "@/lib/project-stage";
import { ActionForm } from "@/components/action-form";
import { FormDialog } from "@/components/form-dialog";
import { ProjectSettingsFields, PROJECT_STATUS_OPTIONS } from "@/components/project-settings-fields";
import { matchesSearch, searchValue, settingsPage, SettingsFilters, SettingsPagination } from "@/components/settings-list";
import { Badge, EmptyState, FlashMessage, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "项目与节点配置" };

const listPath = "/settings/projects";

export default async function ProjectsSettingsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireRole(["ADMIN", "SOFTWARE_MANAGER"]);
  const isAdmin = user.role === "ADMIN";
  const params = await searchParams;
  const notice = parseFlash(params.flash, params.tone === "error" ? "error" : "success");
  const query = searchValue(params.q);
  const status = PROJECT_STATUS_OPTIONS.find(({ value }) => value === params.status)?.value ?? "";
  const projects = getProjectConfigs().filter((project) => isAdmin || project.softwareManagers.some((manager) => manager.id === user.id));
  const list = settingsPage(projects.filter((project) => (!status || project.status === status) && matchesSearch(query, project.name, project.code, project.pmName, project.softwareManagerName)), params.page);
  const people = isAdmin ? getPeople() : [];

  return (
    <>
      <PageHeader
        title="项目与测试节点"
        actions={isAdmin && (
          <FormDialog label={<><Plus size={16} aria-hidden="true" /> 新建项目</>} title="新建项目" testId="new-project-trigger">
            <ActionForm action={saveProjectAction} submitText="创建项目" testId="new-project-form" preserveValuesOnSubmit>
              <ProjectSettingsFields people={people} />
            </ActionForm>
          </FormDialog>
        )}
      />
      <FlashMessage notice={notice} />
      <section className="card" aria-label="项目列表">
        <SettingsFilters action={listPath} search={query} placeholder="项目、编码、PM 或软件经理" hasFilters={Boolean(query || status)}>
          <div className="field"><label className="label" htmlFor="settings-project-status">流程状态</label><select id="settings-project-status" className="select" name="status" defaultValue={status}>
            <option value="">全部状态</option>
            {PROJECT_STATUS_OPTIONS.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
          </select></div>
        </SettingsFilters>
        {list.items.length ? (
          <div className="table-wrap settings-project-table-scroll" role="region" aria-label="项目配置表格" tabIndex={0}>
            <table className="data-table settings-project-table">
              <colgroup>
                <col />
                <col className="settings-project-stage-column" />
                <col className="settings-project-status-column" />
                <col />
                <col className="settings-project-node-column" />
                <col className="settings-project-actions-column" />
              </colgroup>
              <thead><tr><th scope="col">项目</th><th scope="col">阶段</th><th scope="col">流程状态</th><th scope="col">联系人</th><th scope="col" className="settings-number">测试节点</th><th scope="col">操作</th></tr></thead>
              <tbody>{list.items.map((project) => {
                const projectStatus = PROJECT_STATUS_META[project.status];
                const stage = PROJECT_STAGE_META[getProjectStage(project.status, project.stage)];
                return <tr key={project.id}>
                  <th scope="row" className="settings-project-identity"><Link href={`${listPath}/${project.id}`} className="archive-link" prefetch={false}>{project.name}</Link><div className="small muted">{project.code}</div></th>
                  <td><span className="settings-stage">{stage.label}</span></td>
                  <td><Badge tone={projectStatus.tone} dot>{projectStatus.label}</Badge></td>
                  <td className="settings-project-contacts"><span className="small">PM {project.pmName ?? "待指定"}</span><div className="small muted">软件经理 {project.softwareManagerName ?? "待指定"}</div></td>
                  <td className="settings-number">{project.nodes.length} 个</td>
                  <td className="cell-actions"><Link href={`${listPath}/${project.id}`} aria-label={`配置${project.name}`} className="button button-secondary button-sm" prefetch={false}>配置项目</Link></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        ) : <EmptyState title={query || status ? "没有匹配的项目" : "暂无可配置的项目"} description={!query && !status && !isAdmin ? "由管理员分配项目。" : undefined} />}
        <SettingsPagination action={listPath} page={list.page} pageCount={list.pageCount} filters={{ q: query, status }} range={`共 ${list.total} 个项目`} />
      </section>
    </>
  );
}
