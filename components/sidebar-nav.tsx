"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
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
import { workflowHref } from "@/lib/workflow-links";
import { findWorkspaceProject } from "./workspace-project";

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

function Item({ item, pathname }: { item: SidebarItem; pathname: string }) {
  const Icon = iconMap[item.icon as keyof typeof iconMap] ?? Boxes;
  const route = item.href.split("?", 1)[0];
  const active = pathname === route || (route !== "/" && pathname.startsWith(route + "/"));
  return (
    <Link href={item.href} className="sidebar-link" data-active={active} aria-current={active ? "page" : undefined} prefetch={false}>
      <Icon size={15} strokeWidth={1.8} />
      <span>{item.label}</span>
      {item.count !== undefined && item.count > 0 && <span className="sidebar-link-count">{item.count}</span>}
    </Link>
  );
}

export function SidebarNav({
  groups,
  workflowProjects,
}: {
  groups: Array<{ label: string; items: SidebarItem[]; projectScoped?: boolean }>;
  workflowProjects: Array<{ id: number; name: string }>;
}) {
  const pathname = usePathname();
  const search = useSearchParams();
  const workflowPaths = groups.find((group) => group.projectScoped)?.items.map((item) => item.href) ?? [];
  const project = findWorkspaceProject(pathname, search.getAll("project"), workflowPaths, workflowProjects);
  const projectDetail = /^\/projects\/\d+$/.test(pathname);
  return (
    <>
      {groups.map((group) => {
        if (group.items.length === 0 || Boolean(group.projectScoped) !== Boolean(project) || (projectDetail && !project)) return null;
        const label = project ? `${project.name} · 项目流程` : group.label;
        const items = project
          ? group.items.map((item) => ({ ...item, href: workflowHref(item.href, project.id) }))
          : group.items;
        return (
          <div key={group.label}>
            <div className="sidebar-section-label">{label}</div>
            <nav className="sidebar-nav" aria-label={label}>
              {items.map((item) => (
                <Item key={item.href} item={item} pathname={pathname} />
              ))}
            </nav>
          </div>
        );
      })}
    </>
  );
}
