"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavigationPending } from "@/components/navigation-pending";
import {
  Boxes,
  ClipboardList,
  FlaskConical,
  Gauge,
  GitBranch,
  Layers3,
  ListTree,
  Map,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from "lucide-react";

const iconMap = {
  dashboard: Gauge,
  overview: Map,
  packages: Boxes,
  submissions: ClipboardList,
  integration: FlaskConical,
  trial: GitBranch,
  formal: ShieldCheck,
  versions: ListTree,
  areas: Layers3,
  projectSettings: SlidersHorizontal,
  packageSettings: Settings2,
  users: Users,
} as const;

export type SidebarItem = {
  href: string;
  label: string;
  icon: keyof typeof iconMap;
};

export type SidebarGroup = { label: string; items: SidebarItem[] };

function Item({ item, pathname, onNavigate, onPendingChange }: {
  item: SidebarItem;
  pathname: string;
  onNavigate?: () => void;
  onPendingChange?: (pending: boolean) => void;
}) {
  const Icon = iconMap[item.icon];
  const route = item.href.split("?", 1)[0];
  const active = pathname === route || (route !== "/" && pathname.startsWith(route + "/"));
  return (
    <Link href={item.href} className="sidebar-link" data-active={active} aria-current={active ? pathname === route ? "page" : "location" : undefined}
      aria-label={item.label} prefetch={false} onNavigate={onNavigate}>
      <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
      <span>{item.label}</span>
      <NavigationPending onPendingChange={onPendingChange} />
    </Link>
  );
}

export function SidebarNav({ groups, onNavigate, onPendingChange }: {
  groups: SidebarGroup[];
  onNavigate?: () => void;
  onPendingChange?: (pending: boolean) => void;
}) {
  const pathname = usePathname();
  return (
    <>
      {groups.filter((group) => group.items.length > 0).map((group, index) => {
        return (
          <div className="sidebar-group" key={group.label}>
            {index > 0 && <div className="sidebar-section-label">{group.label}</div>}
            <nav className="sidebar-nav" aria-label={group.label}>
              {group.items.map((item) => (
                <Item key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} onPendingChange={onPendingChange} />
              ))}
            </nav>
          </div>
        );
      })}
    </>
  );
}
