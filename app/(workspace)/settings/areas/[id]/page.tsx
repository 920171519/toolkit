import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getListPageSize } from "@/lib/list-pagination";
import { PageSizeSelect } from "@/components/page-size-select";
import { areaDirectoryDetailParams, areaDirectoryListParams, directoryHref, directoryValue } from "@/lib/settings-directory";
import { getAreaConfig, getPeople, type AreaProjectLead, type AreaProjectMember } from "@/lib/organization-queries";
import { readFlash } from "@/lib/flash";
import { getProjectOptions, type ProjectOption } from "@/lib/project-queries";
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
import { FormDialog } from "@/components/form-dialog";
import { GuidanceDialog } from "@/components/guidance-dialog";
import { InfoTooltip } from "@/components/info-tooltip";
import { SettingsPersonPicker, type SettingsPerson } from "@/components/settings-person-picker";
import { matchesSearch, settingsPage, SettingsFilters, SettingsPagination } from "@/components/settings-list";
import { EmptyState, FlashMessage, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "责任田详情" };

const secondaryTrigger = "button button-secondary button-sm";

function AreaProjectRow({ project, lead, members, people, areaId, manageLead, manageMembers, isAdmin, filters }: {
  project: ProjectOption;
  lead?: AreaProjectLead;
  members: AreaProjectMember[];
  people: SettingsPerson[];
  areaId: number;
  manageLead: boolean;
  manageMembers: boolean;
  isAdmin: boolean;
  filters: Record<string, string>;
}) {
  const memberIds = new Set(members.map((member) => member.userId));
  const availableMembers = manageMembers ? people.filter(({ id }) => !memberIds.has(id)) : [];
  const availableLeads = manageLead ? people.filter(({ id }) => id !== lead?.userId) : [];
  const leadActionLabel = lead ? "更换负责人" : "添加负责人";
  const memberKey = members.map((member) => member.id).join("-");
  const accountHelp = {
    detail: isAdmin ? "需要其他候选时，先检查人员的登录状态。" : "需要其他候选时，请联系管理员启用相关账号。",
    href: isAdmin ? "/settings/users" : undefined,
    actionLabel: "查看人员与角色",
  };
  return (
    <li className="settings-record settings-area-record area-project-row" data-testid={`area-project-${project.id}`}>
      <div className="settings-record-name">
        <strong>{project.name}</strong>
        <div className="small muted">{project.code}{project.status === "ARCHIVED" ? " · 已归档" : ""}</div>
      </div>
      <dl className="settings-record-facts">
        <div><dt>负责人</dt><dd>{lead?.userName ?? <span className="muted">待指定</span>}</dd></div>
        <div><dt>成员</dt><dd>
          {members.length ? (
            <FormDialog key={memberKey} label={`${members.length} 人`} title={`${project.name} · 成员`} triggerClassName="button button-ghost button-sm settings-member-count">
              <ul className="settings-people-list">
                {members.map((member) => (
                  <li key={member.id}>
                    <span>{member.userName} <small className="muted">{member.userEmployeeId}</small></span>
                    {manageMembers && <ActionForm action={removeAreaProjectMemberAction} hidden={{ ...filters, memberId: member.id }} submitText={`移除 ${member.userName}`} submitVariant="ghost" submitClassName="button-sm" confirmMessage={`将取消 ${member.userName} 在本责任田的 ${project.name} 成员资格。`} />}
                  </li>
                ))}
              </ul>
            </FormDialog>
          ) : <span className="muted">暂无成员</span>}
        </dd></div>
      </dl>
      {(manageLead || manageMembers) && (
        <div className="settings-record-actions">
          {manageLead && (availableLeads.length > 0 || lead ? (
            <FormDialog key={lead?.userId ?? "new"} label={leadActionLabel} title={`${project.name} · ${leadActionLabel}`} triggerClassName={secondaryTrigger} cancelLabel="取消">
              {availableLeads.length > 0 ? <ActionForm action={assignAreaProjectLeadAction} hidden={{ ...filters, areaId, projectId: project.id, assignmentId: lead?.id, oldUserId: lead?.userId }} submitText={lead ? "更换项目负责人" : "设置项目负责人"}>
                <SettingsPersonPicker name="userId" label="项目负责人" options={availableLeads} />
              </ActionForm> : <p className="small muted">
                没有其他启用的账号可接任。{accountHelp.detail}
                {accountHelp.href && <> <Link href={accountHelp.href} className="archive-link" prefetch={false}>{accountHelp.actionLabel}</Link></>}
              </p>}
              {lead && <div className="settings-dialog-secondary">
                <ActionForm action={removeAreaProjectLeadAction} hidden={{ ...filters, assignmentId: lead.id }} submitText="移除负责人" submitVariant="outline-danger" submitClassName="button-sm" confirmMessage={`将取消 ${lead.userName} 在本责任田的 ${project.name} 负责人资格。`} />
              </div>}
            </FormDialog>
          ) : (
            <GuidanceDialog label={leadActionLabel} title={`${project.name} · ${leadActionLabel}`}
              items={[{ title: "没有可分配的启用账号", ...accountHelp }]} triggerClassName={secondaryTrigger} />
          ))}
          {manageMembers && (availableMembers.length > 0 ? (
            <FormDialog key={`add-${memberKey}`} label={<><Plus size={13} aria-hidden="true" /> 添加成员</>} title={`${project.name} · 添加成员`} triggerClassName={secondaryTrigger} cancelLabel="取消">
              <ActionForm action={assignAreaProjectMemberAction} hidden={{ ...filters, areaId, projectId: project.id }} submitText="添加项目成员">
                <SettingsPersonPicker name="userId" label="项目成员" options={availableMembers} />
              </ActionForm>
            </FormDialog>
          ) : (
            <GuidanceDialog label="添加成员" title={`${project.name} · 添加成员`}
              items={[{ title: people.length ? "启用的账号均已是项目成员" : "没有可分配的启用账号", ...accountHelp }]} triggerClassName={secondaryTrigger} />
          ))}
        </div>
      )}
    </li>
  );
}

export default async function AreaSettingsDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) notFound();
  const area = getAreaConfig(id);
  if (!area) notFound();

  const search = await searchParams;
  const notice = readFlash(search);
  const isAdmin = user.role === "ADMIN";
  const manageArea = isAdmin || area.leaders.some((leader) => leader.userId === user.id);
  const people = manageArea || area.projectLeads.some((lead) => lead.userId === user.id)
    ? getPeople().map((person) => ({ id: person.id, label: `${person.name} · ${person.employeeId}` }))
    : [];
  const leaderIds = new Set(area.leaders.map(({ userId }) => userId));
  const availableLeaders = people.filter(({ id }) => !leaderIds.has(id));
  const leadsByProject = new Map(area.projectLeads.map((lead) => [lead.projectId, lead]));
  const membersByProject = Map.groupBy(area.projectMembers, (member) => member.projectId);
  const query = directoryValue(search.q);
  const pageSize = getListPageSize(search.pageSize);
  const url = `/settings/areas/${area.id}`;
  const relevantProjects = getProjectOptions(true).filter((project) => {
    const lead = leadsByProject.get(project.id);
    const members = membersByProject.get(project.id) ?? [];
    return (manageArea || lead || members.length > 0) && matchesSearch(query, project.name, project.code, lead?.userName, lead?.userEmployeeId, ...members.flatMap((member) => [member.userName, member.userEmployeeId]));
  });
  const list = settingsPage(relevantProjects, search.page, pageSize);
  const listParams = areaDirectoryListParams(search);
  const returnParams = areaDirectoryDetailParams(listParams);
  const filters = { ...returnParams, q: query, pageSize: String(pageSize), page: String(list.page) };
  return (
    <div className="settings-card-stack">
      <PageHeader
        title={area.name}
        description={area.description || undefined}
        actions={<>
          <Link href={directoryHref("/settings/areas", listParams)} className="button button-secondary" prefetch={false}><ArrowLeft size={15} aria-hidden="true" /> 返回责任田列表</Link>
          {manageArea && <FormDialog key={`${area.name}-${area.description}-${notice?.message}`} label="编辑责任田" title="编辑责任田资料" cancelLabel="取消">
            <ActionForm action={saveAreaAction} hidden={{ ...filters, id: area.id }} submitText="保存责任田">
              <div className="settings-card-stack">
                <label className="field"><span className="label">责任田名称</span><input className="input" name="name" defaultValue={area.name} minLength={2} maxLength={30} required /></label>
                <label className="field"><span className="label">说明</span><textarea className="textarea" name="description" defaultValue={area.description} /></label>
              </div>
            </ActionForm>
          </FormDialog>}
        </>}
      />
      <FlashMessage notice={notice} />
      <section className="card" aria-labelledby="area-leaders">
        <div className="card-header"><div><h2 id="area-leaders">责任田主管</h2>{area.isIntegration && <span className="settings-meta">集成测试责任田</span>}</div>
          {isAdmin && (availableLeaders.length > 0 ? <FormDialog key={area.leaders.length} label={<><Plus size={13} aria-hidden="true" /> 添加主管</>} title="添加责任田主管" triggerClassName={secondaryTrigger} cancelLabel="取消">
            <ActionForm action={addAreaLeaderAction} hidden={{ ...filters, areaId: area.id }} submitText="设置主管">
              <SettingsPersonPicker name="userId" label="责任田主管" options={availableLeaders} />
            </ActionForm>
          </FormDialog> : <GuidanceDialog label="添加主管" title="添加责任田主管"
            items={[{
              title: people.length ? "启用的账号均已是本责任田主管" : "没有可分配的启用账号",
              href: "/settings/users", actionLabel: "查看人员与角色",
            }]} triggerClassName={secondaryTrigger} />)}
        </div>
        <div className="card-body settings-area-tools">
            {area.leaders.length ? area.leaders.map((leader) => (
              <span className="person-chip" key={leader.id}>
                {leader.userName} <span className="small muted">{leader.userEmployeeId}</span>
                {isAdmin && <ActionForm action={removeAreaLeaderAction} hidden={{ ...filters, leaderId: leader.id }} submitText={`移除 ${leader.userName}`} submitVariant="ghost" submitClassName="button-sm settings-remove-button" confirmMessage={`将取消 ${leader.userName} 在“${area.name}”的责任田主管资格。`} />}
              </span>
            )) : <p className="small muted">尚未指定主管。</p>}
        </div>
      </section>
      <section className="card" aria-labelledby="area-projects">
        <div className="card-header">
          <div className="settings-label-help">
            <h2 id="area-projects">项目负责人和成员</h2>
            <InfoTooltip label="项目成员维护权限">管理员、责任田主管和本项目负责人可维护项目成员。</InfoTooltip>
          </div>
        </div>
        <SettingsFilters action={url} search={query} placeholder="项目、编码、人员姓名或工号" hasFilters={Boolean(query)} clearHref={directoryHref(url, { ...returnParams, pageSize: String(pageSize) })}>
          {Object.entries(returnParams).filter(([, value]) => value).map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)}
          <PageSizeSelect key={pageSize} name="pageSize" defaultValue={pageSize} />
        </SettingsFilters>
        {list.items.length ? <ul className="settings-record-list">
          {list.items.map((project) => {
            const lead = leadsByProject.get(project.id);
            return <AreaProjectRow key={project.id} project={project} lead={lead} members={membersByProject.get(project.id) ?? []} people={people} areaId={area.id} manageLead={manageArea} manageMembers={manageArea || lead?.userId === user.id} isAdmin={isAdmin} filters={filters} />;
          })}
        </ul> : <EmptyState title={query ? "没有匹配的项目" : "暂无项目分工"}
          description={query ? undefined : manageArea
            ? "创建项目后可在这里分配负责人和成员。"
            : area.leaders.length ? "由责任田主管分配项目负责人和成员。" : "请联系系统管理员分配责任田主管。"}
          action={!query && (isAdmin
            ? <Link className="button button-secondary button-sm" href="/settings/projects" prefetch={false}>查看项目配置</Link>
            : area.leaders.length ? <a className="button button-secondary button-sm" href="#area-leaders">查看责任田主管</a> : undefined)} />}
        <SettingsPagination action={url} page={list.page} pageCount={list.pageCount} filters={filters} range={`共 ${list.total} 个项目`} />
      </section>
      {isAdmin && <section className="card">
        <div className="card-body">
          {area.packageCount > 0 ? (
            <GuidanceDialog label="删除责任田" title="删除责任田"
              items={[{
                title: `${area.name}仍有 ${area.packageCount} 个关联软件包`,
                detail: "请在删除前调整这些软件包的所属责任田。",
                href: directoryHref("/settings/packages", { f_area: String(area.id) }), actionLabel: "查看关联软件包",
              }]} triggerClassName="button button-outline-danger button-sm" />
          ) : (
            <ActionForm action={deleteAreaAction} hidden={{ ...returnParams, id: area.id }} submitText="删除责任田" submitVariant="outline-danger" submitClassName="button-sm"
              confirmMessage={`将永久删除责任田“${area.name}”及其主管和项目分工。`} />
          )}
        </div>
      </section>}
    </div>
  );
}
