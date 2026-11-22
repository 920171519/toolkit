import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { AreaPersonPicker, type AreaPersonOption } from "@/components/area-person-picker";
import { FormDialog } from "@/components/form-dialog";
import styles from "@/components/settings-directory.module.css";
import { SettingsTabs } from "@/components/settings-tabs";
import { EmptyState, FlashMessage, PageHeader } from "@/components/ui";
import { getLedAreaIds } from "@/lib/access";
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
import { requireUser } from "@/lib/auth";
import { getAreaConfigs, getPeople, parseFlash, type AreaProjectLead, type AreaProjectMember } from "@/lib/queries";
import { directoryFilters, directoryHref, type DirectoryParams } from "@/lib/settings-directory";
import { getProjectOptions, type ProjectOption } from "@/lib/workflow-queries";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "责任田详情" };

const secondary = "button button-secondary button-sm";

function ProjectRow({ project, lead, members, people, areaId, manageLead, manageMembers, filters }: {
  project: ProjectOption;
  lead?: AreaProjectLead;
  members: AreaProjectMember[];
  people: AreaPersonOption[];
  areaId: number;
  manageLead: boolean;
  manageMembers: boolean;
  filters: Record<string, string>;
}) {
  const memberIds = new Set(members.map((member) => member.userId));
  const eligibleMembers = manageMembers ? people.filter(({ id }) => !memberIds.has(id)) : [];
  const memberKey = members.map(({ id }) => id).join(".");
  const formFields = { ...filters, areaId, projectId: project.id };
  return (
    <li className={styles.record} data-testid={`area-project-${project.id}`}>
      <div className={styles.recordName}>
        <strong>{project.name}</strong>
        <div className="small muted">{project.code}{project.status === "ARCHIVED" ? " · 已归档" : ""}</div>
      </div>
      <dl>
        <div><dt>项目负责人</dt><dd>{lead?.userName ?? <span className="muted">待指定</span>}</dd></div>
        <div><dt>项目成员</dt><dd>
          {members.length > 0 ? (
            <FormDialog key={memberKey} label={`${members.length} 人`} title={`${project.name} · 项目成员`} triggerClassName={secondary}>
              <ul className={styles.memberList}>
                {members.map((member) => (
                  <li key={member.id}>
                    <span>{member.userName} <small className="muted">{member.userEmployeeId}</small></span>
                    {manageMembers && <ActionForm action={removeAreaProjectMemberAction} hidden={{ ...filters, memberId: member.id }} submitText={`移除 ${member.userName}`} submitVariant="ghost" submitClassName="button-sm" confirmMessage={`移除 ${project.name} 的成员 ${member.userName}？`} />}
                  </li>
                ))}
              </ul>
            </FormDialog>
          ) : <span className="muted">暂无成员</span>}
        </dd></div>
      </dl>
      <div className={styles.recordActions}>
        {manageLead && (lead ? (
          <ActionForm action={removeAreaProjectLeadAction} hidden={{ ...filters, assignmentId: lead.id }} submitText="移除负责人" submitVariant="ghost" submitClassName="button-sm" confirmMessage={`移除 ${project.name} 的负责人 ${lead.userName}？`} />
        ) : people.length > 0 && (
          <FormDialog label="添加负责人" title={`${project.name} · 添加负责人`} triggerClassName={secondary} cancelLabel="取消">
            <ActionForm action={assignAreaProjectLeadAction} hidden={formFields} submitText="设置项目负责人">
              <AreaPersonPicker label="项目负责人" people={people} />
            </ActionForm>
          </FormDialog>
        ))}
        {eligibleMembers.length > 0 && (
          <FormDialog key={`add-${memberKey}`} label={<><Plus size={13} aria-hidden="true" /> 添加成员</>} title={`${project.name} · 添加成员`} triggerClassName={secondary} cancelLabel="取消">
            <ActionForm action={assignAreaProjectMemberAction} hidden={formFields} submitText="添加项目成员">
              <AreaPersonPicker label="项目成员" people={eligibleMembers} />
            </ActionForm>
          </FormDialog>
        )}
      </div>
    </li>
  );
}

export default async function AreaSettingsDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<DirectoryParams>;
}) {
  const user = await requireUser();
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) notFound();
  const [area] = getAreaConfigs(id);
  if (!area) notFound();
  const search = await searchParams;
  const filters = directoryFilters("areas", search);
  const notice = parseFlash(search.flash, search.tone === "error" ? "error" : "success");
  const isAdmin = user.role === "ADMIN";
  const manageArea = isAdmin || area.leaders.some((leader) => leader.userId === user.id);
  const people = manageArea || area.projectLeads.some((lead) => lead.userId === user.id) ? getPeople() : [];
  const leaderIds = new Set(area.leaders.map(({ userId }) => userId));
  const eligibleLeaders = isAdmin ? people.filter(({ id: personId }) => !leaderIds.has(personId)) : [];
  const leads = new Map(area.projectLeads.map((lead) => [lead.projectId, lead]));
  const members = Map.groupBy(area.projectMembers, (member) => member.projectId);
  const projects = getProjectOptions(true).filter((project) => manageArea || leads.has(project.id));
  return (
    <div className={styles.stack}>
      <PageHeader
        title={area.name}
        description={area.description || undefined}
        actions={<>
          <Link href={directoryHref("/settings/areas", filters)} className="button button-secondary" prefetch={false}><ArrowLeft size={15} aria-hidden="true" /> 返回责任田列表</Link>
          {manageArea && <FormDialog key={notice?.message ?? ""} label="编辑责任田" title="编辑责任田资料" cancelLabel="取消">
            <ActionForm action={saveAreaAction} hidden={{ ...filters, id }} submitText="保存责任田">
              <div className={styles.stack}>
                <label className="field"><span className="label">责任田名称</span><input className="input" name="name" defaultValue={area.name} minLength={2} maxLength={30} required /></label>
                <label className="field"><span className="label">责任田说明</span><textarea className="textarea" name="description" defaultValue={area.description} /></label>
              </div>
            </ActionForm>
          </FormDialog>}
        </>}
      />
      <FlashMessage notice={notice} />
      <SettingsTabs
        isAdmin={isAdmin}
        canManageProjects={isAdmin || user.role === "SOFTWARE_MANAGER"}
        canManagePackages={isAdmin || getLedAreaIds(user.id).length > 0}
      />
      <section className="card" aria-labelledby="area-leaders">
        <div className="card-header">
          <div><h2 id="area-leaders">责任田主管</h2>{area.isIntegration && <span className={styles.meta}>集成测试责任田</span>}</div>
          {eligibleLeaders.length > 0 && <FormDialog key={area.leaders.map(({ id: leaderId }) => leaderId).join(".")} label={<><Plus size={13} aria-hidden="true" /> 添加主管</>} title="添加责任田主管" triggerClassName={secondary} cancelLabel="取消">
            <ActionForm action={addAreaLeaderAction} hidden={{ ...filters, areaId: id }} submitText="设置主管">
              <AreaPersonPicker label="责任田主管" people={eligibleLeaders} />
            </ActionForm>
          </FormDialog>}
        </div>
        <div className={`card-body ${styles.people}`}>
          {area.leaders.length ? area.leaders.map((leader) => (
            <div className={styles.areaSupervisor} key={leader.id}>
              {leader.userName} <span className="small muted">{leader.userEmployeeId}</span>
              {isAdmin && <ActionForm action={removeAreaLeaderAction} hidden={{ ...filters, leaderId: leader.id }} submitText={`移除 ${leader.userName}`} submitVariant="ghost" submitClassName="button-sm" confirmMessage={`移除主管 ${leader.userName}？`} />}
            </div>
          )) : <p className="small muted">尚未指定主管。</p>}
        </div>
      </section>
      <section className="card" aria-labelledby="area-projects">
        <div className="card-header"><div><h2 id="area-projects">项目负责人和成员</h2><p className="small muted">各项目负责人可维护本项目的成员。</p></div></div>
        {projects.length ? <ul className={styles.recordList}>
          {projects.map((project) => {
            const lead = leads.get(project.id);
            return <ProjectRow key={project.id} project={project} lead={lead} members={members.get(project.id) ?? []} people={people} areaId={id} manageLead={manageArea} manageMembers={manageArea || lead?.userId === user.id} filters={filters} />;
          })}
        </ul> : <EmptyState title="暂无项目分工" />}
      </section>
      {isAdmin && <section className="card">
        <div className="card-body">
          <ActionForm action={deleteAreaAction} hidden={{ ...filters, id }} submitText="删除责任田" submitVariant="outline-danger" submitClassName="button-sm" disabled={area.packageCount > 0} footerNote={area.packageCount > 0 ? "责任田下仍有软件包，不能删除。" : undefined} confirmMessage={`确认删除责任田“${area.name}”？`} />
        </div>
      </section>}
    </div>
  );
}
