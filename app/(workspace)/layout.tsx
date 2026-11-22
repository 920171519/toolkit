import Link from "next/link";
import { ExternalLink, LogOut, MapPinned } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { ROLE_META } from "@/lib/constants";
import { getLedAreaIds } from "@/lib/access";
import { getProjectOptions } from "@/lib/workflow-queries";
import { getWorkflowProjectOptions } from "@/lib/project-scope";
import { Avatar } from "@/components/ui";
import { Brand } from "@/components/brand";
import { SidebarNav, type SidebarItem } from "@/components/sidebar-nav";
import { TopbarBreadcrumb } from "@/components/topbar-breadcrumb";
import { logoutAction } from "@/app/(auth)/actions";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const accountLabel = `${ROLE_META[user.role].label} · ${user.employeeId}`;
  const canConfigure = user.role === "ADMIN" || user.role === "SOFTWARE_MANAGER";
  const isAdmin = user.role === "ADMIN";
  const canManagePackages = isAdmin || getLedAreaIds(user.id).length > 0;
  const workflowProjects = getWorkflowProjectOptions(user, true);

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

  return (
    <div className="workspace">
      <aside className="sidebar">
        <Brand href="/dashboard" />
        <SidebarNav
          workflowProjects={workflowProjects}
          groups={[
            { label: "部门协同", items: departmentItems },
            { label: "软件包流程", items: workflowItems, projectScoped: true },
            ...(configItems.length > 0
              ? [{ label: "基础配置", items: configItems }]
              : []),
          ]}
        />
        <div className="sidebar-user">
          <div className="sidebar-user-card">
            <Avatar name={user.name} size="sm" />
            <div className="sidebar-user-name" title={user.name}>{user.name}</div>
            <div className="sidebar-user-role" title={accountLabel}>{accountLabel}</div>
            <form action={logoutAction}>
              <button type="submit" className="sidebar-logout" title="退出登录" aria-label="退出登录">
                <LogOut size={14} />
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div className="workspace-main">
        <header className="topbar">
          <TopbarBreadcrumb
            workflowPaths={workflowItems.map((item) => item.href)}
            workflowProjects={workflowProjects}
            catalogProjects={getProjectOptions(true).map(({ id, name }) => ({ id, name }))}
          />
          <div className="topbar-right">
            <span className="topbar-link" style={{ cursor: "default" }}>
              转测窗口 · 每周三 17:00
            </span>
            <Link href="/" target="_blank" className="topbar-link">
              <MapPinned size={13} />
              公开地图
              <ExternalLink size={10} />
            </Link>
            <div className="topbar-mobile-user">
              <Avatar name={user.name} size="sm" />
              <form action={logoutAction}>
                <button type="submit" className="sidebar-logout" title="退出登录" aria-label="退出登录">
                  <LogOut size={14} />
                </button>
              </form>
            </div>
          </div>
        </header>
        <main className="workspace-content">{children}</main>
        <footer className="workspace-footer">
          <span>工程协同台 · {user.department}内部使用</span>
          <span>数据范围：软件包、项目节点与版本流程</span>
        </footer>
      </div>
    </div>
  );
}
