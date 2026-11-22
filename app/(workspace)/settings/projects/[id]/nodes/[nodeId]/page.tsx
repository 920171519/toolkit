import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { canManageProjectWorkflowForProject } from "@/lib/access";
import { getPeople, getProjectConfigs, parseFlash } from "@/lib/queries";
import { addProjectNodeApproverAction, deleteProjectNodeAction, removeProjectNodeApproverAction, updateProjectNodeAction } from "@/lib/actions/settings";
import { ActionForm } from "@/components/action-form";
import { FormDialog } from "@/components/form-dialog";
import { InfoTooltip } from "@/components/info-tooltip";
import { SettingsNodeFields } from "@/components/settings-node-fields";
import { SettingsPersonPicker } from "@/components/settings-person-picker";
import { FlashMessage, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "测试节点配置" };

export default async function ProjectNodeSettingsPage({ params, searchParams }: {
  params: Promise<{ id: string; nodeId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireRole(["ADMIN", "SOFTWARE_MANAGER"]);
  const ids = await params;
  const projectId = Number(ids.id);
  const nodeId = Number(ids.nodeId);
  if (!Number.isSafeInteger(projectId) || !Number.isSafeInteger(nodeId) || projectId < 1 || nodeId < 1 || !canManageProjectWorkflowForProject(user, projectId)) notFound();
  const [project] = getProjectConfigs(projectId);
  const node = project?.nodes.find(({ id }) => id === nodeId);
  if (!node) notFound();
  const search = await searchParams;
  const notice = parseFlash(search.flash, search.tone === "error" ? "error" : "success");
  const people = getPeople();
  const approverIds = new Set(node.approvers.map(({ userId }) => userId));
  const availableApprovers = people.filter(({ id }) => !approverIds.has(id))
    .map(({ id, name, employeeId }) => ({ id, label: `${name} · ${employeeId}` }));
  const projectPath = `/settings/projects/${projectId}`;

  return (
    <div className="settings-card-stack">
      <PageHeader title={`配置节点 ${node.name}`} description={`${project.name} · ${project.code}`}
        actions={<Link href={`${projectPath}#nodes`} className="button button-secondary" prefetch={false}><ArrowLeft size={15} aria-hidden="true" /> 返回测试节点</Link>} />
      <FlashMessage notice={notice} />
      <section className="card" aria-labelledby="node-settings">
        <div className="card-header"><h2 id="node-settings">节点绑定配置</h2></div>
        <div className="card-body">
          <ActionForm key={JSON.stringify(node)} action={updateProjectNodeAction} hidden={{ nodeId }} submitText="保存节点配置" testId="edit-node-form">
            <SettingsNodeFields people={people} node={node} />
          </ActionForm>
        </div>
      </section>
      <section className="card" aria-labelledby="node-approvers">
        <div className="card-header">
          <div className="settings-label-help">
            <h2 id="node-approvers">审批人范围</h2>
            <InfoTooltip label="审批人范围说明">主审批人自动加入。试制发布时记录此范围，已有绑定任务继续使用发布时的范围。</InfoTooltip>
          </div>
          {availableApprovers.length > 0 && (
            <FormDialog key={node.approvers.length} label={<><Plus size={13} aria-hidden="true" /> 添加审批人</>} title="添加节点审批人" triggerClassName="button button-secondary button-sm">
              <ActionForm action={addProjectNodeApproverAction} hidden={{ nodeId }} submitText="加入审批人范围">
                <SettingsPersonPicker name="userId" label="审批人" options={availableApprovers} />
              </ActionForm>
            </FormDialog>
          )}
        </div>
        <div className="card-body">
          {node.approvers.length === 0 ? <p className="muted">尚未配置审批人。</p> :
            <ul className="settings-people-list">
              {node.approvers.map((approver) => (
                <li key={approver.id}>
                  <span>{approver.userName} <small className="muted">{approver.userEmployeeId}</small></span>
                  {approver.userId === node.bindingApproverId ? <span className="settings-meta">主审批人</span> :
                    <ActionForm action={removeProjectNodeApproverAction} hidden={{ assignmentId: approver.id }} submitText={`移除 ${approver.userName}`} submitVariant="ghost" submitClassName="button-sm" confirmMessage={`${approver.userName} 将退出此节点之后发布的绑定任务审批人范围。`} />}
                </li>
              ))}
            </ul>}
        </div>
      </section>
      <section className="card">
        <div className="card-body">
          <ActionForm action={deleteProjectNodeAction} hidden={{ nodeId }} submitText="删除节点" submitVariant="outline-danger" submitClassName="button-sm" confirmMessage={`将永久删除节点“${node.name}”及其绑定审批配置。`} />
        </div>
      </section>
    </div>
  );
}
