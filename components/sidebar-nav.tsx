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

const iconMap = {
  dashboard: Gauge,
  overview: Map,
  packages: Boxes,
  submissions: ClipboardList,
  integration: FlaskConical,
  trial: GitBranch,
  formal: ShieldCheck,
  reviews: ListChecks,
  projects: LayoutGrid,
  map: Map,
  areas: Layers3,
  projectSettings: SlidersHorizontal,
  packageSettings: Settings2,
  users: Users,
  checks: ClipboardCheck,
} as const;

function Item({ item, pathname }: { item: SidebarItem; pathname: string }) {
  const Icon = iconMap[item.icon as keyof typeof iconMap] ?? Boxes;
  const active =
    pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href + "/"));
  return (
    <Link href={item.href} className="sidebar-link" data-active={active} prefetch={false}>
      <Icon size={15} strokeWidth={1.8} />
      <span>{item.label}</span>
      {item.count !== undefined && item.count > 0 && <span className="sidebar-link-count">{item.count}</span>}
    </Link>
  );
}

export function SidebarNav({
  groups,
}: {
  groups: Array<{ label: string; items: SidebarItem[] }>;
}) {
  const pathname = usePathname();
  return (
    <>
      {groups.map((group) =>
        group.items.length === 0 ? null : (
          <div key={group.label}>
            <div className="sidebar-section-label">{group.label}</div>
            <nav className="sidebar-nav" aria-label={group.label}>
              {group.items.map((item) => (
                <Item key={item.href} item={item} pathname={pathname} />
              ))}
            </nav>
          </div>
        ),
      )}
    </>
  );
}
