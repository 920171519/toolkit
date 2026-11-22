"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/settings/areas", label: "责任田" },
  { href: "/settings/projects", label: "项目与节点" },
  { href: "/settings/packages", label: "软件包" },
  { href: "/settings/users", label: "人员与角色", adminOnly: true },
];

export function SettingsTabs({
  isAdmin,
  canManageProjects,
  canManagePackages,
}: {
  isAdmin: boolean;
  canManageProjects: boolean;
  canManagePackages: boolean;
}) {
  const pathname = usePathname();
  const permittedItems = items.filter((item) => !item.adminOnly || isAdmin)
    .filter((item) => item.href !== "/settings/projects" || canManageProjects)
    .filter((item) => item.href !== "/settings/packages" || canManagePackages);
  if (permittedItems.length === 1) return null;
  return (
    <nav className="settings-tabs" aria-label="配置分类">
      {permittedItems.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        return <Link key={item.href} className="settings-tab" href={item.href} prefetch={false} data-active={active} aria-current={active ? "page" : undefined}>{item.label}</Link>;
      })}
    </nav>
  );
}
