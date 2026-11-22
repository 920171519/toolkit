import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowDown, Plus } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { canManageProjectWorkflowForProject } from "@/lib/access";
import { getPeople, getProjectConfigs, parseFlash } from "@/lib/queries";
import { PROJECT_STATUS_META } from "@/lib/constants";
import { getProjectStage, PROJECT_STAGE_META } from "@/lib/project-stage";
import { addProjectNodeAction, deleteProjectAction, saveProjectAction } from "@/lib/actions/settings";
import { ActionForm } from "@/components/action-form";
import { FormDialog } from "@/components/form-dialog";
import { ProjectSettingsFields } from "@/components/project-settings-fields";
import { SettingsNodeFields } from "@/components/settings-node-fields";
import { Badge, EmptyState, FlashMessage, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "项目配置" };

export default async function ProjectSettingsDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireRole(["ADMIN", "SOFTWARE_MANAGER"]);
  const projectId = Number((await params).id);
  if (!Number.isSafeInteger(projectId) || projectId < 1 || !canManageProjectWorkflowForProject(user, projectId)) notFound();
  const [project] = getProjectConfigs(projectId);
  if (!project) notFound();

  const search = await searchParams;
  const notice = parseFlash(search.flash, search.tone === "error" ? "error" : "success");
  const people = getPeople();
  const status = PROJECT_STATUS_META[project.status];
  const stage = PROJECT_STAGE_META[getProjectStage(project.status, project.stage)];
  const path = "/settings/projects/" + project.id;
  const editing = search.edit === "project";
  return (
    <div className="settings-card-stack">
      <PageHeader
        title={project.name}
        description={<><span className="mono">{project.code}</span> · <span className="settings-stage">{stage.label}</span> <Badge tone={status.tone} dot>{status.label}</Badge></>}
        actions={<>
          <Link className="button button-secondary" href="/settings/projects" prefetch={false}><ArrowLeft size={15} aria-hidden="true" /> 返回项目列表</Link>
          <a className="button button-secondary" href="#nodes"><ArrowDown size={15} aria-hidden="true" /> 测试节点</a>
        </>}
      />
      <FlashMessage notice={notice} />
      <section className="card" id="project-profile" aria-labelledby="project-profile-title">
        <div className="card-header">
          <div><h2 id="project-profile-title">项目资料</h2>{editing && <p className="small muted">变更软件经理会同步调整该项目的流程访问权限。</p>}</div>
          {editing
            ? <Link className="button button-secondary button-sm" href={path} prefetch={false}>取消编辑</Link>
            : <Link className="button button-secondary button-sm" data-testid="edit-project-trigger" href={path + "?edit=project#project-profile"} prefetch={false}>编辑项目资料</Link>}
        </div>
        <div className="card-body">
          {editing ? (
            <ActionForm action={saveProjectAction} testId={"edit-project-form-" + project.id} hidden={{ id: project.id }} submitText="保存项目配置">
              <ProjectSettingsFields people={people} project={project} />
            </ActionForm>
          ) : (
            <dl className="settings-profile">
              <div><dt>PM</dt><dd>{project.pms.map((person) => person.name).join("、") || "待指定"}</dd></div>
              <div><dt>软件经理</dt><dd>{project.softwareManagers.map((person) => person.name).join("、") || "待指定"}</dd></div>
              {project.description && <div><dt>说明</dt><dd>{project.description}</dd></div>}
            </dl>
          )}
        </div>
      </section>
      <section className="card" id="nodes" aria-labelledby="settings-project-nodes">
        <div className="card-header">
          <h2 id="settings-project-nodes">测试节点</h2>
          <FormDialog key={project.nodes.length} label={<><Plus size={14} aria-hidden="true" /> 添加节点</>} title="添加测试节点" triggerClassName="button button-primary button-sm" testId={"add-node-trigger-" + project.id}>
            <ActionForm action={addProjectNodeAction} testId={"add-node-form-" + project.id} hidden={{ projectId: project.id }} submitText="添加节点">
              <SettingsNodeFields people={people} />
            </ActionForm>
          </FormDialog>
        </div>
        {project.nodes.length ? (
          <ul className="settings-record-list">
            {project.nodes.map((node) => (
              <li className="settings-record settings-node-record" data-testid={"node-config-" + node.id} key={node.id}>
                <div className="settings-record-name">
                  <strong>{node.name}</strong>
                  {node.description && <div className="small muted">{node.description}</div>}
                </div>
                <dl className="settings-record-facts">
                  <div><dt>绑定责任人</dt><dd>{node.bindingOwnerName ?? "待指定"}</dd></div>
                  <div><dt>主审批人</dt><dd>{node.bindingApproverName ?? "待指定"}</dd></div>
                  <div><dt>通过数量</dt><dd>{node.requiredBindingCount}</dd></div>
                  <div><dt>审批人范围</dt><dd>{node.approvers.length} 人</dd></div>
                </dl>
                <div className="settings-record-actions">
                  <Link href={path + "/nodes/" + node.id} aria-label={"配置节点 " + node.name} className="button button-secondary button-sm" prefetch={false}>配置节点</Link>
                </div>
              </li>
            ))}
          </ul>
        ) : <EmptyState title="尚未配置测试节点" />}
      </section>
      <section className="card">
        <div className="card-body">
          <details>
            <summary className="archive-link">项目删除</summary>
            <div className="settings-inline-form">
              <ActionForm action={deleteProjectAction} hidden={{ id: project.id }} submitText="删除项目" submitVariant="outline-danger" disabled={project.packageCount > 0} footerNote={project.packageCount > 0 ? "项目仍关联软件包。可在项目资料中归档。" : undefined} confirmMessage={`将永久删除项目“${project.name}”及其联系人、分工和测试节点。`} />
            </div>
          </details>
        </div>
      </section>
    </div>
  );
}
