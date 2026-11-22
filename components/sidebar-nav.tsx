"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Boxes,
  ClipboardCheck,
  ClipboardList,
  FlaskConical,
  Gauge,
  GitBranch,
  Layers3,
  LayoutGrid,
  ListChecks,
  ListTree,
  Map,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from "lucide-react";

export type SidebarItem = {
  href: string;
  label: string;
  icon: string;
  count?: number;
};

export type SidebarGroup = { label: string; items: SidebarItem[] };

const iconMap = {
  dashboard: Gauge,
  overview: Map,
  packages: Boxes,
  submissions: ClipboardList,
  integration: FlaskConical,
  trial: GitBranch,
  formal: ShieldCheck,
  versions: ListTree,
  reviews: ListChecks,
  projects: LayoutGrid,
  map: Map,
  areas: Layers3,
  projectSettings: SlidersHorizontal,
  packageSettings: Settings2,
  users: Users,
  checks: ClipboardCheck,
} as const;

function Item({ item, pathname, onNavigate }: { item: SidebarItem; pathname: string; onNavigate?: () => void }) {
  const Icon = iconMap[item.icon as keyof typeof iconMap] ?? Boxes;
  const route = item.href.split("?", 1)[0];
  const active = pathname === route || (route !== "/" && pathname.startsWith(route + "/"));
  return (
    <Link href={item.href} className="sidebar-link" data-active={active} aria-current={active ? pathname === route ? "page" : "location" : undefined} prefetch={false} onClick={onNavigate}>
      <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
      <span>{item.label}</span>
      {item.count !== undefined && item.count > 0 && <span className="sidebar-link-count">{item.count}</span>}
    </Link>
  );
}

export function SidebarNav({ groups, onNavigate }: { groups: SidebarGroup[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <>
      {groups.filter((group) => group.items.length > 0).map((group, index) => {
        return (
          <div className="sidebar-group" key={group.label}>
            {index > 0 && <div className="sidebar-section-label">{group.label}</div>}
            <nav className="sidebar-nav" aria-label={group.label}>
              {group.items.map((item) => (
                <Item key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
              ))}
            </nav>
          </div>
        );
      })}
    </>
  );
}
