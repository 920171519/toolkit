import type { Metadata } from "next";
import { KeyRound, ShieldCheck, UserCog } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { getAdminUsers, parseFlash } from "@/lib/queries";
import { ROLE_META, ROLES, type Role } from "@/lib/constants";
import {
  saveUserProfileAction,
  setUserActiveAction,
  updateUserRoleAction,
} from "@/lib/actions/settings";
import { ActionForm } from "@/components/action-form";
import { Avatar, Badge, FlashMessage, PageHeader } from "@/components/ui";
import { SettingsTabs } from "@/components/settings-tabs";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "人员与角色" };

export default async function UsersSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireRole(["ADMIN"]);
  const params = await searchParams;
  const notice = parseFlash(params.flash, params.tone === "error" ? "error" : "success");
  const users = getAdminUsers();
  const activeUsers = users.filter((item) => item.isActive).length;

  return (
    <>
      <PageHeader
        eyebrow="Settings / People & roles"
        title="人员与角色"
        description="维护部门人员角色与账号状态。注册账号默认成为部门成员，管理员可根据职责调整角色。"
      />
      <FlashMessage notice={notice} />
      <SettingsTabs isAdmin={user.role === "ADMIN"} />

      <div className="metric-row" style={{ marginBottom: 18 }}>
        <div className="metric">
          <div className="metric-label">启用账号</div>
          <div className="metric-value">{activeUsers}</div>
          <div className="metric-note">停用账号不能登录，历史记录保留</div>
        </div>
        <div className="metric">
          <div className="metric-label">软件包责任人</div>
          <div className="metric-value">{users.filter((item) => item.ownedPackages > 0).length}</div>
          <div className="metric-note">实际负责启用中软件包的人员</div>
        </div>
        <div className="metric">
          <div className="metric-label">软件经理</div>
          <div className="metric-value">{users.filter((item) => item.role === "SOFTWARE_MANAGER" && item.isActive).length}</div>
          <div className="metric-note">负责组织转测、发试制与转正发布</div>
        </div>
        <div className="metric">
          <div className="metric-label">管理员</div>
          <div className="metric-value">{users.filter((item) => item.role === "ADMIN" && item.isActive).length}</div>
          <div className="metric-note">系统至少保留一名启用管理员</div>
        </div>
      </div>

      <div className="two-col">
        <section className="card">
          <div className="card-header">
            <div>
              <h2 style={{ fontSize: 18 }}>人员列表</h2>
              <p className="small muted" style={{ marginTop: 3 }}>
                角色变更会立即影响工作流操作权限。不能修改自己的角色或停用自己。
              </p>
            </div>
            <Badge tone="slate">{users.length} 人</Badge>
          </div>
          <div className="card-body" style={{ paddingTop: 12 }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {users.map((member) => {
                const roleMeta = ROLE_META[member.role];
                const isSelf = member.id === user.id;
                return (
                  <div
                    key={member.id}
                    data-testid={`user-row-${member.id}`}
                    style={{
                      padding: "14px 0",
                      borderBottom: "1px solid var(--line)",
                      opacity: member.isActive ? 1 : 0.6,
                    }}
                  >
                    <div className="toolbar-spread">
                      <div className="toolbar" style={{ gap: 10 }}>
                        <Avatar name={member.name} />
                        <div>
                          <div className="toolbar" style={{ gap: 7 }}>
                            <span style={{ fontSize: 14, fontWeight: 600 }}>{member.name}</span>
                            {isSelf && <Badge tone="sky">我</Badge>}
                            {!member.isActive && <Badge tone="rose">已停用</Badge>}
                            <Badge tone={roleMeta.tone}>{roleMeta.label}</Badge>
                          </div>
                          <div className="small muted">
                            {member.title || "未填写职位"} · {member.employeeId} · {member.department}
                          </div>
                        </div>
                      </div>
                      <div className="toolbar" style={{ gap: 10 }}>
                        <span className="small muted">{member.ownedPackages} 个软件包</span>
                        <details>
                          <summary
                            className="button button-secondary button-sm"
                            style={{ display: "inline-flex", cursor: "pointer", listStyle: "none" }}
                          >
                            <UserCog size={12} />
                            <span className="when-closed">管理</span>
                            <span className="when-open">收起</span>
                          </summary>
                          <div style={{ marginTop: 14, minWidth: "min(360px, 80vw)" }}>
                            <h4 style={{ fontSize: 12, marginBottom: 8 }}>人员资料</h4>
                            <ActionForm
                              action={saveUserProfileAction}
                              hidden={{ userId: member.id }}
                              submitText="保存资料"
                              submitClassName="button-sm"
                            >
                              <div className="form-grid">
                                <label className="field">
                                  <span className="label">姓名</span>
                                  <input className="input" name="name" defaultValue={member.name} required />
                                </label>
                                <label className="field">
                                  <span className="label">职位</span>
                                  <input className="input" name="title" defaultValue={member.title} />
                                </label>
                              </div>
                            </ActionForm>
                            <hr className="divider" style={{ margin: "14px 0" }} />
                            <h4 style={{ fontSize: 12, marginBottom: 8 }}>角色配置</h4>
                            {isSelf ? (
                              <p className="small muted">不能修改自己的角色。请由另一位管理员操作。</p>
                            ) : (
                              <ActionForm
                                action={updateUserRoleAction}
                                testId={`user-role-form-${member.id}`}
                                hidden={{ userId: member.id }}
                                submitText="更新角色"
                                submitClassName="button-sm"
                              >
                                <div className="toolbar" style={{ alignItems: "stretch" }}>
                                  <select className="select" name="role" defaultValue={member.role} style={{ flex: 1 }}>
                                    {ROLES.map((role) => (
                                      <option key={role} value={role}>
                                        {ROLE_META[role].label}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </ActionForm>
                            )}
                            {!isSelf && (
                              <>
                                <hr className="divider" style={{ margin: "14px 0" }} />
                                <ActionForm
                                  action={setUserActiveAction}
                                  hidden={{ userId: member.id, active: member.isActive ? "0" : "1" }}
                                  submitText={member.isActive ? "停用账号" : "启用账号"}
                                  submitVariant={member.isActive ? "outline-danger" : "secondary"}
                                  submitClassName="button-sm"
                                  confirmMessage={
                                    member.isActive
                                      ? `确认停用 ${member.name} 的账号？该人员将无法登录。`
                                      : `确认重新启用 ${member.name} 的账号？`
                                  }
                                  footerNote={
                                    member.ownedPackages > 0 && member.isActive
                                      ? "该人员仍负责软件包，需先转移责任人。"
                                      : undefined
                                  }
                                />
                              </>
                            )}
                          </div>
                        </details>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <aside style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <section className="card">
            <div className="card-header">
              <div>
                <h2 style={{ fontSize: 16 }}>角色权限说明</h2>
                <p className="small muted" style={{ marginTop: 3 }}>
                  当前版本已按角色限制关键操作，后续可继续细化权限点。
                </p>
              </div>
              <ShieldCheck size={17} style={{ color: "var(--brand)" }} />
            </div>
            <div className="card-body" style={{ paddingTop: 10 }}>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {ROLES.map((role: Role) => (
                  <div key={role} style={{ padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
                    <div className="toolbar" style={{ gap: 7 }}>
                      <Badge tone={ROLE_META[role].tone}>{ROLE_META[role].label}</Badge>
                      <span className="small muted">
                        {users.filter((item) => item.role === role).length} 人
                      </span>
                    </div>
                    <p className="small muted" style={{ marginTop: 4, lineHeight: 1.65 }}>
                      {ROLE_META[role].description}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </section>
          <section className="card card-muted">
            <div className="card-body">
              <div className="toolbar" style={{ gap: 7 }}>
                <KeyRound size={15} style={{ color: "var(--brand)" }} />
                <h3 style={{ fontSize: 13 }}>账号与访问边界</h3>
              </div>
              <p className="note" style={{ marginTop: 6 }}>
                公开首页无需登录即可访问，内部工作台与流程数据需要登录。注册时自动记录部门归属；
                后续接入部门组织架构后，可在此基础上扩展跨部门访问控制。
              </p>
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
