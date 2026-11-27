import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { canManageProjectWorkflowForProject } from "@/lib/access";
import { getProjectNodeConfig } from "@/lib/project-queries";
import { getActivePersonOptions } from "@/lib/organization-queries";
import { readFlash } from "@/lib/flash";
import { addProjectNodeApproverAction, deleteProjectNodeAction, removeProjectNodeApproverAction, updateProjectNodeAction } from "@/lib/actions/settings";
import { getNodeApproverRemovalBlocker, getNodeDeletionBlockers } from "@/lib/settings-queries";
import { directoryHref, projectDirectoryDetailParams, projectDirectoryListParams } from "@/lib/settings-directory";
import { getNodeCandidateGuidance, packageReferenceGuidance } from "@/lib/settings-guidance";
import { ActionForm } from "@/components/action-form";
import { FormDialog } from "@/components/form-dialog";
import { GuidanceDialog } from "@/components/guidance-dialog";
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
  const user = await requireUser();
  const ids = await params;
  const projectId = Number(ids.id);
  const nodeId = Number(ids.nodeId);
  if (!Number.isSafeInteger(projectId) || !Number.isSafeInteger(nodeId) || projectId < 1 || nodeId < 1 || !canManageProjectWorkflowForProject(user, projectId)) notFound();
  const config = getProjectNodeConfig(projectId, nodeId);
  if (!config) notFound();
  const { project, node } = config;
  const search = await searchParams;
  const notice = readFlash(search);
  const people = getActivePersonOptions();
  const nodeCandidateBlocker = getNodeCandidateGuidance(user, people.length);
  const approverIds = new Set(node.approvers.map(({ userId }) => userId));
  const availableApprovers = people.filter(({ id }) => !approverIds.has(id))
    .map(({ id, name, employeeId }) => ({ id, label: `${name} · ${employeeId}` }));
  const projectPath = `/settings/projects/${projectId}`;
  const listContext = projectDirectoryDetailParams(projectDirectoryListParams(search, true));
  const deletion = getNodeDeletionBlockers(nodeId);
  const deleteReasons = packageReferenceGuidance(user, deletion.packages, "从本软件包的使用范围调整此节点。", "usage");
  if (deletion.hasBindingHistory) {
    deleteReasons.push({
      title: "保留节点绑定历史",
      detail: "此节点已有绑定记录，需要保留。",
      href: `/versions?project=${projectId}`,
      actionLabel: "查看版本全链路",
    });
  }

  return (
    <div className="settings-card-stack workspace-edit-form settings-project-editor">
      <PageHeader title={`配置节点 ${node.name}`} description={`${project.name} · ${project.code}`}
        actions={<Link href={directoryHref(projectPath, listContext) + "#nodes"} className="button button-secondary" prefetch={false}><ArrowLeft size={15} aria-hidden="true" /> 返回测试节点</Link>} />
      <FlashMessage notice={notice} />
      <section className="card" aria-labelledby="node-settings">
        <div className="card-header"><h2 id="node-settings">节点绑定配置</h2></div>
        <div className="card-body">
          {nodeCandidateBlocker ? <GuidanceDialog label="保存节点配置" title="保存节点配置" items={[nodeCandidateBlocker]} /> : (
            <ActionForm key={JSON.stringify(node)} action={updateProjectNodeAction} hidden={{ ...listContext, nodeId }} submitText="保存节点配置" testId="edit-node-form">
              <SettingsNodeFields people={people} node={node} />
            </ActionForm>
          )}
        </div>
      </section>
      <section className="card" aria-labelledby="node-approvers">
        <div className="card-header">
          <div className="settings-label-help">
            <h2 id="node-approvers">审批人范围</h2>
            <InfoTooltip label="审批人范围说明">主审批人自动加入。试制发布时记录此范围，已有绑定任务继续使用发布时的范围。</InfoTooltip>
          </div>
          {availableApprovers.length > 0 ? (
            <FormDialog key={node.approvers.length} label={<><Plus size={13} aria-hidden="true" /> 添加审批人</>} title="添加节点审批人" triggerClassName="button button-secondary button-sm">
              <ActionForm action={addProjectNodeApproverAction} hidden={{ ...listContext, nodeId }} submitText="加入审批人范围">
                <SettingsPersonPicker name="userId" label="审批人" options={availableApprovers} />
              </ActionForm>
            </FormDialog>
          ) : (
            <GuidanceDialog label="添加审批人" title="添加节点审批人"
              items={[{
                title: people.length ? "启用的账号均已在此范围" : "没有启用的账号",
                detail: user.role === "ADMIN" ? "需添加其他人员时，可先启用其账号。" : "需添加其他人员时，请联系管理员启用账号。",
                href: user.role === "ADMIN" ? "/settings/users" : undefined,
                actionLabel: "查看人员与角色",
              }]}
              triggerClassName="button button-secondary button-sm" />
          )}
        </div>
        <div className="card-body">
          {node.approvers.length === 0 ? <p className="muted">尚未配置审批人。</p> :
            <ul className="settings-people-list">
              {node.approvers.map((approver) => {
                const label = `移除 ${approver.userName}`;
                const blocker = getNodeApproverRemovalBlocker(approver.userId, node.bindingApproverId, node.approvers.length);
                const isPrimary = blocker?.target === "primary";
                return (
                  <li key={approver.id}>
                    <span>{approver.userName} <small className="muted">{approver.userEmployeeId}</small>
                      {isPrimary && <span className="settings-meta"> 主审批人</span>}
                    </span>
                    {blocker ? (
                      <GuidanceDialog label={label} title={label} triggerClassName="button button-ghost button-sm"
                        items={[{
                          title: blocker.message,
                          href: isPrimary ? "#node-settings" : "#node-approvers",
                          actionLabel: isPrimary ? "前往节点绑定配置" : "查看审批人范围",
                        }]} />
                    ) : (
                      <ActionForm action={removeProjectNodeApproverAction} hidden={{ ...listContext, assignmentId: approver.id }} submitText={label}
                        submitVariant="ghost" submitClassName="button-sm" confirmMessage={`${approver.userName} 将退出此节点之后发布的绑定任务审批人范围。`} />
                    )}
                  </li>
                );
              })}
            </ul>}
        </div>
      </section>
      <section className="card">
        <div className="card-body">
          {deleteReasons.length > 0 ? (
            <GuidanceDialog label="删除节点" title={`删除节点 ${node.name}`}
              description="此节点仍关联以下记录。"
              items={deleteReasons} triggerClassName="button button-outline-danger button-sm" />
          ) : (
            <ActionForm action={deleteProjectNodeAction} hidden={{ ...listContext, nodeId }} submitText="删除节点" submitVariant="outline-danger" submitClassName="button-sm" confirmMessage={`将永久删除节点“${node.name}”及其绑定审批配置。`} />
          )}
        </div>
      </section>
    </div>
  );
}
