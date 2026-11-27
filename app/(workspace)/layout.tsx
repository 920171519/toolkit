import Link from "next/link";
import { KeyRound, LogOut, MapPinned } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { ROLE_META } from "@/lib/constants";
import { getLedAreaIds, getManagedProjectIdsForUser } from "@/lib/access";
import { getAccountAreaLabel } from "@/lib/queries";
import { getWorkflowProjectOptions } from "@/lib/project-scope";
import { getProjectOptions } from "@/lib/project-queries";
import { Avatar } from "@/components/ui";
import { Brand } from "@/components/brand";
import type { SidebarItem } from "@/components/sidebar-nav";
import { WorkspaceNavigation } from "@/components/workspace-navigation";
import { logoutAction } from "@/app/(auth)/actions";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const areaLabel = getAccountAreaLabel(user.id);
  const accountLabel = `${ROLE_META[user.role].label} · ${user.employeeId}`;
  const isAdmin = user.role === "ADMIN";
  const canConfigure = isAdmin || getManagedProjectIdsForUser(user.id).length > 0;
  const canManagePackages = isAdmin || getLedAreaIds(user.id).length > 0;

  const departmentItems: SidebarItem[] = [
    { href: "/dashboard", label: "我的工作台", icon: "dashboard" },
    { href: "/overview", label: "项目总览", icon: "overview" },
  ];

  const workflowItems: SidebarItem[] = [
    { href: "/packages", label: "软件版本总览", icon: "packages" },
    {
      href: "/submissions",
      label: "待转测申请",
      icon: "submissions",
    },
    {
      href: "/integration",
      label: "集成测试",
      icon: "integration",
    },
    {
      href: "/trial",
      label: "试制与绑定验证",
      icon: "trial",
    },
    {
      href: "/formal",
      label: "转正发布",
      icon: "formal",
    },
    { href: "/versions", label: "版本全链路", icon: "versions" },
  ];

  const configItems: SidebarItem[] = [
    { href: "/settings/areas", label: "责任田", icon: "areas" },
    ...(canConfigure ? [{ href: "/settings/projects", label: "项目配置", icon: "projectSettings" } as SidebarItem] : []),
    ...(canManagePackages ? [{ href: "/settings/packages", label: "软件包配置", icon: "packageSettings" } as SidebarItem] : []),
    ...(isAdmin ? [{ href: "/settings/users", label: "人员与角色", icon: "users" } as SidebarItem] : []),
  ];
  const groups = [
    { label: "部门协同", items: departmentItems },
    { label: "基础配置", items: configItems },
  ];

  return (
    <WorkspaceNavigation
      groups={groups}
      workflow={workflowItems}
      projects={getWorkflowProjectOptions(user, true)}
      catalogProjects={getProjectOptions(true).map(({ id, name }) => ({ id, name }))}
      brand={<Brand href="/dashboard" subtitle={areaLabel} />}
      areaLabel={areaLabel}
      sidebarFooter={
        <div className="sidebar-user">
          <div className="sidebar-user-card">
            <Avatar name={user.name} size="sm" />
            <div className="sidebar-user-name" title={user.name}>{user.name}</div>
            <div className="sidebar-user-role" title={accountLabel}>{accountLabel}</div>
            <form action={logoutAction}>
              <button type="submit" className="sidebar-logout" title="退出登录" aria-label="退出登录">
                <LogOut size={14} aria-hidden="true" />
              </button>
            </form>
          </div>
        </div>
      }
      actions={<>
            <Link href="/" prefetch={false} className="topbar-link topbar-contact-link">
              <MapPinned size={13} aria-hidden="true" />
              <span>项目联系人</span>
            </Link>
            <Link href="/account/password" prefetch={false} className="topbar-link topbar-password-link" aria-label="修改密码" title="修改密码">
              <KeyRound size={16} aria-hidden="true" />
              <span>修改密码</span>
            </Link>
            <div className="topbar-mobile-user">
              <Avatar name={user.name} size="sm" />
              <form action={logoutAction}>
                <button type="submit" className="sidebar-logout" title="退出登录" aria-label="退出登录">
                  <LogOut size={14} aria-hidden="true" />
                </button>
              </form>
            </div>
      </>}
    >
      {children}
    </WorkspaceNavigation>
  );
}
