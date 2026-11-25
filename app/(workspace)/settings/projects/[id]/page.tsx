import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowDown, ChevronRight, Plus } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { canManageProjectWorkflowForProject } from "@/lib/access";
import { getPeople, getProjectConfigs, parseFlash } from "@/lib/queries";
import { PROJECT_STATUS_META } from "@/lib/constants";
import { getProjectStage, PROJECT_STAGE_META } from "@/lib/project-stage";
import { addProjectNodeAction, deleteProjectAction, saveProjectAction } from "@/lib/actions/settings";
import { directoryHref, projectDirectoryDetailParams, projectDirectoryListParams } from "@/lib/settings-directory";
import { getProjectDeletionBlockers } from "@/lib/settings";
import { getNodeCandidateGuidance, getProjectManagerCandidateGuidance, packageReferenceGuidance } from "@/lib/settings-guidance";
import { ActionForm } from "@/components/action-form";
import { FormDialog } from "@/components/form-dialog";
import { GuidanceDialog, type GuidanceItem } from "@/components/guidance-dialog";
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
  const listParams = projectDirectoryListParams(search, true);
  const listContext = projectDirectoryDetailParams(listParams);
  const detailHref = directoryHref(path, listContext);
  const editHref = directoryHref(path, { ...listContext, edit: "project" }) + "#project-profile";
  const editing = search.edit === "project";
  const nodeCandidateBlocker = getNodeCandidateGuidance(user, people.length);
  const managerCandidateBlocker = editing ? getProjectManagerCandidateGuidance(user, people) : null;
  const deletion = getProjectDeletionBlockers(project.id);
  const deleteReasons: GuidanceItem[] = [
    ...packageReferenceGuidance(user, deletion.packages, "此软件包仍关联本项目的节点。", "usage"),
    ...deletion.batches.map((batch) => ({
      title: `测试批次 ${batch.code}`,
      href: `/integration/${batch.id}?project=${project.id}`,
      actionLabel: "查看批次",
    })),
    ...(deletion.hasBindingHistory ? [{
      title: "保留节点绑定历史",
      href: `/versions?project=${project.id}`,
      actionLabel: "查看版本全链路",
    }] : []),
  ];
  return (
    <div className="settings-card-stack">
      <PageHeader
        title={project.name}
        description={<><span className="mono">{project.code}</span> · <span className="settings-stage">{stage.label}</span> <Badge tone={status.tone} dot>{status.label}</Badge></>}
        actions={<>
          <Link className="button button-secondary" href={directoryHref("/settings/projects", listParams)} prefetch={false}><ArrowLeft size={15} aria-hidden="true" /> 返回项目列表</Link>
          {project.status === "ARCHIVED" && <Link className="button button-secondary" href={`/versions?project=${project.id}`} prefetch={false}>查看归档版本</Link>}
          <a className="button button-secondary" href="#nodes"><ArrowDown size={15} aria-hidden="true" /> 测试节点</a>
        </>}
      />
      <FlashMessage notice={notice} />
      <section className={editing ? "card workspace-edit-form settings-project-editor" : "card"} id="project-profile" aria-labelledby="project-profile-title">
        <div className="card-header">
          <div><h2 id="project-profile-title">项目资料</h2>{editing && <p className="small muted">变更软件经理会同步调整该项目的流程访问权限。</p>}</div>
          {editing
            ? <Link className="button button-secondary button-sm" href={detailHref} prefetch={false}>取消编辑</Link>
            : <Link className="button button-secondary button-sm" data-testid="edit-project-trigger" href={editHref} prefetch={false}>编辑项目资料</Link>}
        </div>
        <div className="card-body">
          {editing && !managerCandidateBlocker ? (
            <ActionForm action={saveProjectAction} testId={"edit-project-form-" + project.id} hidden={{ ...listContext, id: project.id }} submitText="保存项目配置">
              <ProjectSettingsFields people={people} project={project} canManagePeople={user.role === "ADMIN"} />
            </ActionForm>
          ) : (
            <>
              <dl className="settings-profile">
                <div><dt>PM</dt><dd>{project.pms.map((person) => person.name).join("、") || "待指定"}</dd></div>
                <div><dt>软件经理</dt><dd>{project.softwareManagers.map((person) => person.name).join("、") || "待指定"}</dd></div>
                {project.description && <div><dt>说明</dt><dd>{project.description}</dd></div>}
              </dl>
              {managerCandidateBlocker && <GuidanceDialog label="保存项目配置" title="保存项目配置" items={[managerCandidateBlocker]} />}
            </>
          )}
        </div>
      </section>
      <section className="card" id="nodes" aria-labelledby="settings-project-nodes">
        <div className="card-header">
          <h2 id="settings-project-nodes">测试节点</h2>
          {nodeCandidateBlocker ? <GuidanceDialog label="添加节点" title="添加测试节点"
            items={[nodeCandidateBlocker]} triggerClassName="button button-primary button-sm" /> : (
              <FormDialog key={project.nodes.length} label={<><Plus size={14} aria-hidden="true" /> 添加节点</>} title="添加测试节点" triggerClassName="button button-primary button-sm" testId={"add-node-trigger-" + project.id}>
                <ActionForm action={addProjectNodeAction} testId={"add-node-form-" + project.id} hidden={{ ...listContext, projectId: project.id }} submitText="添加节点">
                  <SettingsNodeFields people={people} />
                </ActionForm>
              </FormDialog>
            )}
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
                  <Link href={directoryHref(`${path}/nodes/${node.id}`, listContext)} aria-label={"配置节点 " + node.name} className="button button-secondary button-sm" prefetch={false}>配置节点</Link>
                </div>
              </li>
            ))}
          </ul>
        ) : <EmptyState title="尚未配置测试节点" description="添加节点后，才能为软件包设置本项目的使用范围。" />}
      </section>
      <details className="card settings-disclosure">
        <summary><ChevronRight size={16} aria-hidden="true" />项目删除</summary>
        <div className="card-body">
          <div className="settings-inline-form">
            {deleteReasons.length > 0 ? (
              <GuidanceDialog label="删除项目" title="删除项目"
                description="此项目仍关联以下记录。结束项目时可在项目资料中归档并保留历史。"
                items={[...deleteReasons, { title: "保留项目资料和历史", href: editHref, actionLabel: "前往项目资料" }]}
                triggerClassName="button button-outline-danger" />
            ) : (
              <ActionForm action={deleteProjectAction} hidden={{ ...listContext, id: project.id }} submitText="删除项目" submitVariant="outline-danger"
                confirmMessage={`将永久删除项目“${project.name}”及其联系人、分工和测试节点。`} />
            )}
          </div>
        </div>
      </details>
    </div>
  );
}
