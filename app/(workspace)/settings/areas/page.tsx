import type { Metadata } from "next";
import { Crown, Plus, ShieldCheck, UserPlus, Users } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getAreaConfigs, getPeople, parseFlash } from "@/lib/queries";
import { getProjectOptions } from "@/lib/workflow-queries";
import {
  addAreaLeaderAction,
  assignAreaProjectLeadAction,
  assignAreaProjectMemberAction,
  deleteAreaAction,
  removeAreaLeaderAction,
  removeAreaProjectLeadAction,
  removeAreaProjectMemberAction,
  saveAreaAction,
} from "@/lib/actions/settings";
import { ActionForm } from "@/components/action-form";
import { Badge, FlashMessage, PageHeader } from "@/components/ui";
import { FormDialog } from "@/components/form-dialog";
import { SettingsTabs } from "@/components/settings-tabs";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "责任田配置" };

export default async function AreasSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN";
  const params = await searchParams;
  const notice = parseFlash(params.flash, params.tone === "error" ? "error" : "success");
  const areas = getAreaConfigs();
  const people = getPeople();
  const projects = getProjectOptions(true);
  const hasAreaRole = isAdmin || areas.some((area) => area.leaders.some((leader) => leader.userId === user.id));

  return (
    <>
      <PageHeader
        eyebrow="Settings / Responsibility areas"
        title="责任田配置"
        description="所有成员都可以查看责任田。管理员创建责任田并指定主管；主管添加各项目负责人；项目负责人再添加项目成员。项目负责人可按项目维护责任田内的软件包责任信息。"
        actions={isAdmin ? (
          <FormDialog label={<><Plus size={14} /> 新建责任田</>} title="新建责任田" description="管理员创建责任田后，再在责任田卡片中指定责任田主管。" triggerClassName="button button-primary" testId="new-area-trigger">
            <ActionForm action={saveAreaAction} submitText="创建责任田" testId="new-area-form">
              <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
                <label className="field"><span className="label">责任田名称</span><input className="input" name="name" placeholder="例如 显示与图形" required /></label>
                <label className="field"><span className="label">责任田说明</span><textarea className="textarea" name="description" placeholder="说明责任田负责的软件包范围和职责。" /></label>
              </div>
            </ActionForm>
          </FormDialog>
        ) : undefined}
      />
      <FlashMessage notice={notice} />
      <SettingsTabs isAdmin={isAdmin} canManageProjects={isAdmin || user.role === "SOFTWARE_MANAGER"} canManagePackages={hasAreaRole} />

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {areas.map((area) => {
            const areaLeader = area.leaders.some((leader) => leader.userId === user.id);
            const canManageLeads = isAdmin || areaLeader;
            return (
              <section className="card" key={area.id}>
                <div className="card-body" style={{ padding: 19 }}>
                  <div className="toolbar-spread">
                    <div className="toolbar" style={{ gap: 9 }}>
                      <span className="area-icon"><ShieldCheck size={16} /></span>
                      <div>
                        <div className="toolbar" style={{ gap: 7 }}>
                          <h2 style={{ fontSize: 18 }}>{area.name}</h2>
                          {area.isIntegration && <Badge tone="teal" dot>集成测试责任田</Badge>}
                          <span className="chip">{area.packageCount} 个软件包</span>
                        </div>
                        <p className="small muted" style={{ marginTop: 3 }}>{area.description}</p>
                      </div>
                    </div>
                    {canManageLeads && (
                      <details>
                        <summary className="button button-secondary button-sm" style={{ listStyle: "none", cursor: "pointer" }}>
                          <span className="when-closed">编辑责任田</span><span className="when-open">取消编辑</span>
                        </summary>
                        <div style={{ marginTop: 14, minWidth: "min(520px, 80vw)" }}>
                          <ActionForm action={saveAreaAction} hidden={{ id: area.id }} submitText="保存责任田">
                            <div className="form-grid">
                              <label className="field"><span className="label">责任田名称</span><input className="input" name="name" defaultValue={area.name} required /></label>
                              <label className="field"><span className="label">说明</span><input className="input" name="description" defaultValue={area.description} /></label>
                            </div>
                          </ActionForm>
                          {isAdmin && (
                            <div style={{ marginTop: 12 }}>
                              <ActionForm action={deleteAreaAction} hidden={{ id: area.id }} submitText="删除责任田" submitVariant="outline-danger" submitClassName="button-sm" disabled={area.packageCount > 0} footerNote={area.packageCount > 0 ? "责任田下仍有软件包，不能删除。" : undefined} confirmMessage={`确认删除责任田“${area.name}”？`} />
                            </div>
                          )}
                        </div>
                      </details>
                    )}
                  </div>

                  <div className="inset-panel" style={{ marginTop: 14 }}>
                    <div className="split-row">
                      <div className="toolbar" style={{ gap: 7 }}>
                        <Crown size={14} style={{ color: "var(--brand)" }} />
                        <span style={{ fontSize: 12, fontWeight: 700 }}>责任田主管</span>
                        <span className="small muted">可多人，负责添加各项目负责人</span>
                      </div>
                      {isAdmin && (
                        <details>
                          <summary className="archive-link" style={{ listStyle: "none", cursor: "pointer" }}>
                            <span className="when-closed"><UserPlus size={12} /> 添加主管</span><span className="when-open">取消添加</span>
                          </summary>
                          <div style={{ marginTop: 10, minWidth: 320 }}>
                            <ActionForm action={addAreaLeaderAction} hidden={{ areaId: area.id }} submitText="设置主管" submitClassName="button-sm">
                              <label className="field"><span className="label">人员</span><select className="select" name="userId" required defaultValue=""><option value="" disabled>选择责任田主管</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.employeeId}</option>)}</select></label>
                            </ActionForm>
                          </div>
                        </details>
                      )}
                    </div>
                    <div className="toolbar" style={{ gap: 7, marginTop: 9, flexWrap: "wrap" }}>
                      {area.leaders.map((leader) => (
                        <span className="person-chip" key={leader.id}>
                          <Users size={12} /> {leader.userName} <span className="small muted">{leader.userTitle}</span>
                          {isAdmin && <ActionForm action={removeAreaLeaderAction} hidden={{ leaderId: leader.id }} submitText="×" submitVariant="ghost" submitClassName="chip-remove" confirmMessage={`移除主管 ${leader.userName}？`} title="移除主管" />}
                        </span>
                      ))}
                      {area.leaders.length === 0 && <span className="small muted">尚未指定责任田主管</span>}
                    </div>
                  </div>

                  <div className="area-projects" style={{ marginTop: 13 }}>
                    <div className="toolbar-spread" style={{ marginBottom: 8 }}>
                      <div className="toolbar" style={{ gap: 7 }}><Users size={14} style={{ color: "var(--muted)" }} /><span style={{ fontSize: 12, fontWeight: 700 }}>按项目划分</span><span className="small muted">项目负责人及项目成员</span></div>
                    </div>
                    {projects.map((project) => {
                      const lead = area.projectLeads.find((item) => item.projectId === project.id);
                      const members = area.projectMembers.filter((item) => item.projectId === project.id);
                      const isProjectLead = lead?.userId === user.id;
                      const canManageMembers = isAdmin || areaLeader || isProjectLead;
                      if (!lead && !canManageLeads) return null;
                      return (
                        <div className="area-project-row" key={project.id}>
                          <div className="split-row">
                            <div className="toolbar" style={{ gap: 7, flexWrap: "wrap" }}>
                              <span className="chip">{project.code}</span>
                              <strong style={{ fontSize: 12 }}>{project.name}</strong>
                              {lead ? <span className="person-pill">负责人 {lead.userName}</span> : <Badge tone="amber">未指定负责人</Badge>}
                              {members.map((member) => (
                                <span className="member-pill" key={member.id}>{member.userName}
                                  {canManageMembers && <ActionForm action={removeAreaProjectMemberAction} hidden={{ memberId: member.id }} submitText="×" submitVariant="ghost" submitClassName="chip-remove" confirmMessage={`移除成员 ${member.userName}？`} />}
                                </span>
                              ))}
                            </div>
                            <div className="toolbar" style={{ gap: 6 }}>
                              {canManageLeads && (
                                <details>
                                  <summary className="archive-link" style={{ listStyle: "none", cursor: "pointer" }}>
                                    <span className="when-closed">{lead ? "更换负责人" : "添加负责人"}</span><span className="when-open">取消</span>
                                  </summary>
                                  <div style={{ marginTop: 9, minWidth: 310 }}>
                                    {lead && <ActionForm action={removeAreaProjectLeadAction} hidden={{ assignmentId: lead.id }} submitText="移除当前负责人" submitVariant="outline-danger" submitClassName="button-sm" confirmMessage={`移除 ${project.name} 负责人？`} />}
                                    <div style={{ marginTop: lead ? 8 : 0 }}>
                                      <ActionForm action={assignAreaProjectLeadAction} hidden={{ areaId: area.id, projectId: project.id }} submitText={lead ? "更换项目负责人" : "设置项目负责人"} submitClassName="button-sm">
                                        <label className="field"><span className="label">项目负责人</span><select className="select" name="userId" required defaultValue=""><option value="" disabled>选择人员</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.employeeId}</option>)}</select></label>
                                      </ActionForm>
                                    </div>
                                  </div>
                                </details>
                              )}
                              {canManageMembers && (
                                <details>
                                  <summary className="archive-link" style={{ listStyle: "none", cursor: "pointer" }}>
                                    <span className="when-closed"><Plus size={12} /> 添加成员</span><span className="when-open">取消</span>
                                  </summary>
                                  <div style={{ marginTop: 9, minWidth: 310 }}>
                                    <ActionForm action={assignAreaProjectMemberAction} hidden={{ areaId: area.id, projectId: project.id }} submitText="添加项目成员" submitClassName="button-sm">
                                      <label className="field"><span className="label">项目成员</span><select className="select" name="userId" required defaultValue=""><option value="" disabled>选择人员</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.employeeId}</option>)}</select></label>
                                    </ActionForm>
                                  </div>
                                </details>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>
            );
          })}
        </div>
    </>
  );
}
