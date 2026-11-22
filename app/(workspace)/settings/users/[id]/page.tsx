import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { directoryFilters, directoryHref } from "@/lib/settings-directory";
import { getAdminUsers, parseFlash } from "@/lib/queries";
import { ROLE_META, ROLES } from "@/lib/constants";
import { saveUserProfileAction, setUserActiveAction, updateUserRoleAction } from "@/lib/actions/settings";
import { ActionForm } from "@/components/action-form";
import { InfoTooltip } from "@/components/info-tooltip";
import { Badge, FlashMessage, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "账号管理" };

export default async function UserSettingsDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireRole(["ADMIN"]);
  const userId = Number((await params).id);
  if (!Number.isSafeInteger(userId) || userId < 1) notFound();
  const [member] = getAdminUsers(userId);
  if (!member) notFound();

  const search = await searchParams;
  const legacyRole = ROLES.find((role) => role === search.role);
  const listParams = directoryFilters("users", { ...search, f_role: search.f_role ?? legacyRole });
  const notice = parseFlash(search.flash, search.tone === "error" ? "error" : "success");
  const isSelf = member.id === user.id;
  const blockedDeactivation = member.isActive && member.activeOwnedPackages > 0;
  return (
    <div className="settings-card-stack">
      <PageHeader
        title={member.name}
        description={<>{member.employeeId} · {member.department} · <span className="settings-meta">{ROLE_META[member.role].label}</span> <Badge tone={member.isActive ? "emerald" : "slate"} dot>{member.isActive ? "启用" : "停用"}</Badge></>}
        actions={<Link href={directoryHref("/settings/users", listParams)} className="button button-secondary" prefetch={false}><ArrowLeft size={15} aria-hidden="true" /> 返回人员列表</Link>}
      />
      <FlashMessage notice={notice} />
      <section className="card">
        <div className="card-header"><div><h2>人员资料</h2></div></div>
        <div className="card-body">
          <ActionForm action={saveUserProfileAction} hidden={{ ...listParams, userId }} submitText="保存资料">
            <div className="form-grid">
              <label className="field"><span className="label">姓名</span><input className="input" name="name" defaultValue={member.name} minLength={2} maxLength={30} required /></label>
              <label className="field"><span className="label">职位</span><input className="input" name="title" defaultValue={member.title} /></label>
            </div>
          </ActionForm>
        </div>
      </section>
      <section className="card">
        <div className="card-header"><h2>责任田</h2></div>
        <div className="card-body toolbar">
          {member.areas.length ? member.areas.map((area) => <Link key={area.id} className="button button-secondary button-sm" href={`/settings/areas/${area.id}`} prefetch={false}>{area.name}</Link>) : <p className="small muted">未分配责任田。</p>}
        </div>
      </section>
      <section className="card">
        <div className="card-header">
          <div className="settings-label-help">
            <h2>工作流权限</h2>
            <InfoTooltip label={`${ROLE_META[member.role].label}权限说明`}>{ROLE_META[member.role].description}</InfoTooltip>
          </div>
        </div>
        <div className="card-body">
          {isSelf ? <p className="small muted">自己的角色由其他管理员维护。</p> : (
            <ActionForm action={updateUserRoleAction} testId={`user-role-form-${member.id}`} hidden={{ ...listParams, userId }} submitText="更新角色" footerNote="角色变更立即生效。">
              <div className="field"><label className="label" htmlFor="settings-role-edit">系统角色</label><select id="settings-role-edit" className="select" name="role" defaultValue={member.role}>
                {ROLES.map((role) => <option value={role} key={role}>{ROLE_META[role].label}</option>)}
              </select></div>
            </ActionForm>
          )}
        </div>
      </section>
      {!isSelf && <section className="card">
        <div className="card-header"><h2>登录状态</h2></div>
        <div className="card-body">
          <ActionForm
            action={setUserActiveAction}
            hidden={{ ...listParams, userId, active: member.isActive ? "0" : "1" }}
            submitText={member.isActive ? "停用账号" : "启用账号"}
            submitVariant={member.isActive ? "outline-danger" : "secondary"}
            disabled={blockedDeactivation}
            footerNote={blockedDeactivation ? `此账号仍负责 ${member.activeOwnedPackages} 个启用的软件包。请先转交责任人。` : undefined}
            confirmMessage={member.isActive ? `将停用 ${member.name} 的账号并结束其登录会话。已有业务记录保留。` : `重新启用后，${member.name} 可以登录。`}
          />
        </div>
      </section>}
    </div>
  );
}
