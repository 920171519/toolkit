import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import styles from "@/components/settings-directory.module.css";
import { SettingsTabs } from "@/components/settings-tabs";
import { Badge, FlashMessage, PageHeader } from "@/components/ui";
import { saveUserProfileAction, setUserActiveAction, updateUserRoleAction } from "@/lib/actions/settings";
import { requireRole } from "@/lib/auth";
import { ROLE_META, ROLES } from "@/lib/constants";
import { getAdminUsers, parseFlash } from "@/lib/queries";
import { directoryFilters, directoryHref, type DirectoryParams } from "@/lib/settings-directory";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "账号管理" };

export default async function UserSettingsDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<DirectoryParams>;
}) {
  const user = await requireRole(["ADMIN"]);
  const userId = Number((await params).id);
  if (!Number.isSafeInteger(userId) || userId < 1) notFound();
  const [member] = getAdminUsers(userId);
  if (!member) notFound();

  const search = await searchParams;
  const filters = directoryFilters("users", search);
  const hidden = { ...filters, userId };
  const notice = parseFlash(search.flash, search.tone === "error" ? "error" : "success");
  const isSelf = member.id === user.id;
  const blockedDeactivation = member.isActive && member.activeOwnedPackages > 0;
  const role = ROLE_META[member.role];
  return (
    <div className={styles.stack}>
      <PageHeader
        title={member.name}
        description={<>{member.employeeId} · {member.department} · <Badge tone={role.tone}>{role.label}</Badge> <Badge tone={member.isActive ? "emerald" : "slate"} dot>{member.isActive ? "启用" : "停用"}</Badge></>}
        actions={<Link href={directoryHref("/settings/users", filters)} className="button button-secondary" prefetch={false}><ArrowLeft size={15} aria-hidden="true" /> 返回人员列表</Link>}
      />
      <FlashMessage notice={notice} />
      <SettingsTabs isAdmin />
      <section className="card">
        <div className="card-header"><h2>人员资料</h2></div>
        <div className="card-body">
          <ActionForm action={saveUserProfileAction} hidden={hidden} submitText="保存资料">
            <div className="form-grid">
              <label className="field"><span className="label">姓名</span><input className="input" name="name" defaultValue={member.name} minLength={2} maxLength={30} required /></label>
              <label className="field"><span className="label">职位</span><input className="input" name="title" defaultValue={member.title} /></label>
            </div>
          </ActionForm>
        </div>
      </section>
      <section className="card">
        <div className="card-header"><h2>责任田</h2></div>
        <div className={`card-body ${styles.people}`}>
          {member.areas.length ? member.areas.map((area) => <Link key={area.id} className="button button-secondary button-sm" href={`/settings/areas/${area.id}`} prefetch={false}>{area.name}</Link>) : <p className="small muted">未分配责任田。</p>}
        </div>
      </section>
      <section className="card">
        <div className="card-header"><div><h2>工作流权限</h2><p className="small muted">{role.description}</p></div></div>
        <div className="card-body">
          {isSelf ? <p className="small muted">自己的角色由其他管理员维护。</p> : (
            <ActionForm action={updateUserRoleAction} testId={`user-role-form-${member.id}`} hidden={hidden} submitText="更新角色">
              <label className="field">
                <span className="label">系统角色</span>
                <select key={member.role} className="select" name="role" defaultValue={member.role}>
                  {ROLES.map((value) => <option value={value} key={value}>{ROLE_META[value].label}</option>)}
                </select>
              </label>
            </ActionForm>
          )}
        </div>
      </section>
      {!isSelf && <section className="card">
        <div className="card-header"><div><h2>登录状态</h2><p className="small muted">停用会结束此账号的登录会话，业务记录会保留。</p></div></div>
        <div className="card-body">
          <ActionForm
            action={setUserActiveAction}
            hidden={{ ...hidden, active: member.isActive ? "0" : "1" }}
            submitText={member.isActive ? "停用账号" : "启用账号"}
            submitVariant={member.isActive ? "outline-danger" : "secondary"}
            disabled={blockedDeactivation}
            footerNote={blockedDeactivation ? `此账号仍负责 ${member.activeOwnedPackages} 个启用的软件包。请先转交责任人。` : undefined}
            confirmMessage={member.isActive ? `停用 ${member.name} 的账号并结束其登录会话？` : `重新启用 ${member.name} 的账号？`}
          />
        </div>
      </section>}
    </div>
  );
}
