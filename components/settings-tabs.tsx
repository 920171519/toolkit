"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/settings/areas", label: "责任田" },
  { href: "/settings/projects", label: "项目与节点" },
  { href: "/settings/packages", label: "软件包" },
  { href: "/settings/users", label: "人员与角色", adminOnly: true },
];

export function SettingsTabs({ isAdmin, showManagementTabs = true }: { isAdmin: boolean; showManagementTabs?: boolean }) {
  const pathname = usePathname();
  return (
    <nav className="settings-tabs" aria-label="基础配置">
      {items
        .filter((item) => !item.adminOnly || isAdmin)
        .filter((item) => showManagementTabs || item.href === "/settings/areas")
        .map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link key={item.href} className="settings-tab" href={item.href} data-active={active}>
              {item.label}
            </Link>
          );
        })}
    </nav>
  );
}
