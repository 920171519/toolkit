import type { Metadata } from "next";
import { CalendarDays, LayoutGrid, Plus } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { getPeople, getProjectConfigs, parseFlash } from "@/lib/queries";
import { getLedAreaIds, getManagedProjectIdsForUser } from "@/lib/access";
import { DEFAULT_PROJECT_STAGE, getProjectStage, PROJECT_STAGE_META, PROJECT_STAGES, type ProjectStage } from "@/lib/project-stage";
import {
  addProjectNodeAction,
  addProjectNodeApproverAction,
  deleteProjectAction,
  deleteProjectNodeAction,
  removeProjectNodeApproverAction,
  saveProjectAction,
  updateProjectNodeAction,
} from "@/lib/actions/settings";
import { ActionForm } from "@/components/action-form";
import { Badge, FlashMessage, PageHeader } from "@/components/ui";
import { FormDialog } from "@/components/form-dialog";
import { ProjectContactPicker } from "@/components/project-contact-picker";
import { SettingsTabs } from "@/components/settings-tabs";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "项目与节点配置" };

const statusOptions = [
  { value: "ACTIVE", label: "进行中" },
  { value: "PAUSED", label: "已暂停" },
  { value: "ARCHIVED", label: "已归档" },
];

function ProjectStageField({ id, stage = DEFAULT_PROJECT_STAGE }: { id: string; stage?: ProjectStage }) {
  return (
    <div className="field">
      <label htmlFor={id} className="label">项目阶段</label>
      <select id={id} className="select" name="stage" defaultValue={stage}>
        {PROJECT_STAGES.map((item) => <option key={item} value={item}>{PROJECT_STAGE_META[item].label}</option>)}
      </select>
    </div>
  );
}

export default async function ProjectsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireRole(["ADMIN", "SOFTWARE_MANAGER"]);
  const params = await searchParams;
  const notice = parseFlash(params.flash, params.tone === "error" ? "error" : "success");
  const assignedProjects = user.role === "ADMIN" ? null : new Set(getManagedProjectIdsForUser(user.id));
  const projects = getProjectConfigs().filter((project) => assignedProjects === null || assignedProjects.has(project.id));
  const people = getPeople();
  const softwareManagers = people.filter((person) => person.role === "SOFTWARE_MANAGER");

  return (
    <>
      <PageHeader
        eyebrow="Settings / Projects"
        title="项目与测试节点"
        description="维护项目阶段、PM、测试节点和流程状态。归档项目在项目总览显示为已结束。每个测试节点需要规划设备条码绑定验证责任人、主审批人与审批人范围、绑定通过数量，试制发布会按这些配置生成绑定任务。"
        actions={user.role === "ADMIN" ? (
          <FormDialog label="新增项目" title="新建项目" description="仅管理员可以新建项目。" triggerClassName="button button-primary" testId="new-project-trigger">
            <ActionForm action={saveProjectAction} submitText="创建项目" testId="new-project-form">
              <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
                <label className="field"><span className="label">项目名称</span><input className="input" name="name" placeholder="例如 星云 N2" required /></label>
                <label className="field"><span className="label">项目编码</span><input className="input" name="code" placeholder="N2" required /></label>
                <ProjectContactPicker label="PM" name="pmUserIds" options={people} />
                <ProjectContactPicker label="软件经理" name="softwareManagerIds" options={softwareManagers} />
                <label className="field"><span className="label">项目说明</span><textarea className="textarea" name="description" placeholder="简要说明项目定位与交付目标。" /></label>
                <ProjectStageField id="new-project-stage" />
                <input type="hidden" name="status" value="ACTIVE" />
              </div>
            </ActionForm>
            <p className="page-footnote">创建项目后，请在项目卡片中添加测试节点（如 EVT / DVT / PVT）。节点是绑定验证的最小单位。</p>
          </FormDialog>
        ) : undefined}
      />
      <FlashMessage notice={notice} />
      <SettingsTabs isAdmin={user.role === "ADMIN"} canManagePackages={user.role === "ADMIN" || getLedAreaIds(user.id).length > 0} />

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {projects.map((project) => (
            <section className="card" key={project.id}>
              <div className="card-body" style={{ padding: 19 }}>
                <div className="toolbar-spread">
                  <div className="toolbar" style={{ gap: 9 }}>
                    <span
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 9,
                        background: "var(--brand-soft)",
                        color: "var(--brand)",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <LayoutGrid size={16} />
                    </span>
                    <div>
                      <div className="toolbar" style={{ gap: 7 }}>
                        <h2 style={{ fontSize: 18 }}>{project.name}</h2>
                        <span className="chip">{project.code}</span>
                        <span className="small">{PROJECT_STAGE_META[getProjectStage(project.status, project.stage)].label}</span>
                        <Badge tone={project.status === "ACTIVE" ? "emerald" : project.status === "PAUSED" ? "amber" : "slate"} dot>
                          {statusOptions.find((item) => item.value === project.status)?.label}
                        </Badge>
                      </div>
                      <div className="small muted" style={{ marginTop: 2 }}>
                        PM {project.pmName ?? "待指定"} · 软件经理 {project.softwareManagerName ?? "待指定"} · {project.packageCount} 个软件包
                      </div>
                    </div>
                  </div>
                  <details>
                    <summary className="button button-secondary button-sm" style={{ display: "inline-flex", cursor: "pointer", listStyle: "none" }}>
                      <span className="when-closed">编辑项目</span>
                      <span className="when-open">取消编辑</span>
                    </summary>
                    <div style={{ marginTop: 16, minWidth: "min(540px, 80vw)" }}>
                      <ActionForm action={saveProjectAction} testId={`edit-project-form-${project.id}`} hidden={{ id: project.id }} submitText="保存项目配置">
                        <div className="form-grid">
                          <label className="field">
                            <span className="label">项目名称</span>
                            <input className="input" name="name" defaultValue={project.name} required />
                          </label>
                          <label className="field">
                            <span className="label">项目编码</span>
                            <input className="input" name="code" defaultValue={project.code} required />
                          </label>
                          <ProjectContactPicker label="PM" name="pmUserIds" options={people} defaultSelectedIds={project.pms.map((person) => person.id)} className="span-2" />
                          <ProjectContactPicker label="软件经理" name="softwareManagerIds" options={softwareManagers} defaultSelectedIds={project.softwareManagers.map((person) => person.id)} className="span-2" />
                          <label className="field">
                            <span className="label">流程状态</span>
                            <select className="select" name="status" defaultValue={project.status}>
                              {statusOptions.map((status) => (
                                <option key={status.value} value={status.value}>{status.label}</option>
                              ))}
                            </select>
                          </label>
                          <ProjectStageField id={`project-stage-${project.id}`} stage={project.stage} />
                          <label className="field span-2">
                            <span className="label">项目说明</span>
                            <textarea className="textarea" name="description" defaultValue={project.description} />
                          </label>
                        </div>
                      </ActionForm>
                      <div style={{ marginTop: 13 }}>
                        <ActionForm
                          action={deleteProjectAction}
                          hidden={{ id: project.id }}
                          submitText="删除项目"
                          submitVariant="outline-danger"
                          submitClassName="button-sm"
                          disabled={project.packageCount > 0}
                          footerNote={project.packageCount > 0 ? "项目仍关联软件包使用范围，不能删除。" : undefined}
                          confirmMessage={`确认删除项目“${project.name}”？`}
                        />
                      </div>
                    </div>
                  </details>
                </div>
                <p className="change-copy" style={{ marginTop: 9 }}>{project.description}</p>

                <div className="inset-panel" style={{ marginTop: 13 }}>
                  <div className="split-row">
                    <div className="toolbar" style={{ gap: 7 }}>
                      <CalendarDays size={14} style={{ color: "var(--muted)" }} />
                      <span style={{ fontSize: 12, fontWeight: 600 }}>测试节点与绑定责任</span>
                      <span className="small muted">绑定验证按节点展开，每个节点需配置设备条码责任人与电子流审批人</span>
                    </div>
                    <details>
                      <summary className="archive-link" style={{ listStyle: "none", cursor: "pointer" }}>
                        <span className="when-closed"><Plus size={12} /> 添加节点</span>
                        <span className="when-open">取消添加</span>
                      </summary>
                      <div style={{ marginTop: 10, minWidth: "min(540px, 85vw)" }}>
                        <ActionForm action={addProjectNodeAction} testId={`add-node-form-${project.id}`} hidden={{ projectId: project.id }} submitText="添加节点" submitClassName="button-sm">
                          <div className="form-grid">
                            <label className="field">
                              <span className="label">节点名称</span>
                              <input className="input" name="name" placeholder="例如 EVT" required />
                            </label>
                            <label className="field">
                              <span className="label">说明</span>
                              <input className="input" name="description" placeholder="例如 工程验证" />
                            </label>
                            <label className="field">
                              <span className="label">绑定验证责任人 <span className="required-mark">*</span></span>
                              <select className="select" name="bindingOwnerId" required defaultValue="">
                                <option value="" disabled>选择责任人</option>
                                {people.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.employeeId}</option>)}
                              </select>
                            </label>
                            <label className="field">
                              <span className="label">主审批人 <span className="required-mark">*</span></span>
                              <select className="select" name="bindingApproverId" required defaultValue="">
                                <option value="" disabled>选择审批人</option>
                                {people.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.employeeId}</option>)}
                              </select>
                            </label>
                            <label className="field">
                              <span className="label">绑定通过数量要求</span>
                              <input className="input" type="number" name="requiredBindingCount" min={1} max={20} defaultValue={1} required />
                            </label>
                          </div>
                        </ActionForm>
                      </div>
                    </details>
                  </div>
                  <div className="node-config-list" style={{ marginTop: 10 }}>
                    {project.nodes.map((node) => (
                      <div className="node-config-row" key={node.id}>
                        <div className="node-config-main">
                          <div className="toolbar" style={{ gap: 7 }}>
                            <span className="node-name">{node.name}</span>
                            {node.description && <span className="small muted">{node.description}</span>}
                            <Badge tone={node.bindingOwnerId && node.bindingApproverId ? "emerald" : "rose"}>
                              {node.bindingOwnerId && node.bindingApproverId ? "绑定责任已配置" : "绑定责任待配置"}
                            </Badge>
                          </div>
                          <div className="node-config-meta">
                            <span>绑定责任人 <strong>{node.bindingOwnerName ?? "未配置"}</strong></span>
                            <span>主审批人 <strong>{node.bindingApproverName ?? "未配置"}</strong></span>
                            <span>通过数量要求 <strong>{node.requiredBindingCount}</strong></span>
                          </div>
                          <div className="node-approver-range">
                            <span className="small muted">审批人范围：</span>
                            {node.approvers.map((approver) => (
                              <span className="member-pill" key={approver.id}>
                                {approver.userName}
                                {approver.userId !== node.bindingApproverId && (
                                  <ActionForm action={removeProjectNodeApproverAction} hidden={{ assignmentId: approver.id }} submitText="×" submitVariant="ghost" submitClassName="chip-remove" confirmMessage={`从审批人范围移除 ${approver.userName}？`} />
                                )}
                              </span>
                            ))}
                            <details className="node-approver-add">
                              <summary className="archive-link" style={{ listStyle: "none", cursor: "pointer" }}>+ 添加审批人</summary>
                              <div style={{ marginTop: 7, minWidth: 250 }}>
                                <ActionForm action={addProjectNodeApproverAction} hidden={{ nodeId: node.id }} submitText="加入审批人范围" submitClassName="button-sm">
                                  <label className="field"><span className="label">人员</span><select className="select" name="userId" required defaultValue=""><option value="" disabled>选择审批人</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.employeeId}</option>)}</select></label>
                                </ActionForm>
                              </div>
                            </details>
                          </div>
                        </div>
                        <details className="inline-config">
                          <summary className="archive-link" style={{ listStyle: "none", cursor: "pointer" }}>
                            <span className="when-closed">配置节点</span>
                            <span className="when-open">取消配置</span>
                          </summary>
                          <div style={{ marginTop: 10, minWidth: "min(540px, 85vw)" }}>
                            <ActionForm action={updateProjectNodeAction} hidden={{ nodeId: node.id }} submitText="保存节点配置" submitClassName="button-sm">
                              <div className="form-grid">
                                <label className="field"><span className="label">节点名称</span><input className="input" name="name" defaultValue={node.name} required /></label>
                                <label className="field"><span className="label">说明</span><input className="input" name="description" defaultValue={node.description} /></label>
                                <label className="field"><span className="label">绑定验证责任人</span><select className="select" name="bindingOwnerId" defaultValue={node.bindingOwnerId ?? ""} required><option value="" disabled>选择责任人</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.employeeId}</option>)}</select></label>
                                <label className="field"><span className="label">绑定电子流审批人</span><select className="select" name="bindingApproverId" defaultValue={node.bindingApproverId ?? ""} required><option value="" disabled>选择审批人</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.employeeId}</option>)}</select></label>
                                <label className="field"><span className="label">绑定通过数量要求</span><input className="input" type="number" name="requiredBindingCount" min={1} max={20} defaultValue={node.requiredBindingCount} required /></label>
                              </div>
                            </ActionForm>
                            <div style={{ marginTop: 9 }}>
                              <ActionForm action={deleteProjectNodeAction} hidden={{ nodeId: node.id }} submitText="删除节点" submitVariant="outline-danger" submitClassName="button-sm" confirmMessage={`确认删除节点“${node.name}”？`} />
                            </div>
                          </div>
                        </details>
                      </div>
                    ))}
                    {project.nodes.length === 0 && <span className="small muted">尚未配置节点</span>}
                  </div>
                </div>
              </div>
            </section>
          ))}
          {projects.length === 0 && (
            <div className="card"><div className="card-body muted">暂无项目，请先创建。</div></div>
          )}
        </div>
    </>
  );
}
