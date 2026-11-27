"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ChevronRight, ChevronsUpDown, Menu } from "lucide-react";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { FormDialog } from "@/components/form-dialog";
import { NavigationPending } from "@/components/navigation-pending";
import { SidebarNav, type SidebarGroup, type SidebarItem } from "@/components/sidebar-nav";
import { getPageWindow } from "@/lib/list-pagination";
import { workflowHref } from "@/lib/workflow-links";
import { safeOverviewReturnPath } from "@/lib/return-to";

type Project = { id: number; name: string; code: string; status: string };
type Crumb = { label: string; href?: string };
const projectListPageSize = 12;
const catalogViewKey = "toolkit.lastProjectCatalogView";

const detailLabels: Record<string, string> = {
  "/packages": "软件包详情",
  "/submissions": "准备转测批次",
  "/integration": "转测批次详情",
  "/trial": "绑定验证详情",
  "/formal": "转正发布详情",
  "/versions": "版本详情",
  "/settings/areas": "责任田详情",
  "/settings/projects": "项目详情",
  "/settings/packages": "软件包详情",
  "/settings/users": "人员详情",
};

function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="当前位置" className="breadcrumb">
      <ol>
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`}>
            {index > 0 && <ChevronRight size={12} aria-hidden="true" />}
            {item.href ? <Link href={item.href} prefetch={false}>{item.label}</Link> : <strong aria-current="page">{item.label}</strong>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function MobileWorkspaceMenu({ groups, areaLabel }: { groups: SidebarGroup[]; areaLabel: string }) {
  const details = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);
  const [pending, setPending] = useState(false);
  const close = () => { if (details.current) details.current.open = false; };
  useEffect(() => {
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !details.current?.contains(event.target)) close();
    };
    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, []);
  return <>
    <details className="workspace-mobile-menu" ref={details} onKeyDown={(event) => {
      if (event.key === "Escape") {
        close();
        trigger.current?.focus();
      }
    }}>
      <summary ref={trigger} aria-label="主导航" data-navigation-pending={pending || undefined}><Menu size={19} aria-hidden="true" /></summary>
      <div className="workspace-mobile-links">
        <p className="workspace-mobile-area">{areaLabel}</p>
        <SidebarNav groups={groups} onPendingChange={setPending} onNavigate={() => {
          close();
          trigger.current?.focus({ preventScroll: true });
        }} />
      </div>
    </details>
    <span className="sr-only" role="status">{pending && "正在加载页面"}</span>
  </>;
}

function ProjectChoices({ projects, section, filters }: { projects: Project[]; section: SidebarItem; filters?: Record<string, string | undefined> }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const terms = query.normalize("NFKC").toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = projects.filter((project) => terms.every((term) => `${project.code} ${project.name}`.normalize("NFKC").toLowerCase().includes(term)));
  const { current, pages: lastPage, offset, end } = getPageWindow(matches.length, projectListPageSize, page);
  return (
    <>
      <label className="field">
        <span className="label">搜索项目</span>
        <input className="input" type="search" data-dialog-autofocus value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="名称或代号" />
      </label>
      <ul className="project-switch-list">
        {matches.slice(offset, end).map((project) => (
          <li key={project.id}>
            <Link className="project-switch-option" prefetch={false} href={workflowHref(section.href, project.id, filters)}>
              <strong>{project.name}</strong><small>{project.code}{project.status === "ARCHIVED" ? " · 已归档" : ""}</small>
            </Link>
          </li>
        ))}
      </ul>
      {matches.length === 0 && <p className="small muted" role="status">没有匹配的项目</p>}
      {lastPage > 1 && <nav className="workspace-dialog-pagination" aria-label="项目分页">
        <button type="button" className="button button-secondary button-sm" disabled={current === 1} onClick={() => setPage(current - 1)}>上一页</button>
        <span className="small muted" role="status">第 {current} / {lastPage} 页</span>
        <button type="button" className="button button-secondary button-sm" disabled={current === lastPage} onClick={() => setPage(current + 1)}>下一页</button>
      </nav>}
    </>
  );
}

export function WorkspaceNavigation({ groups, workflow, projects, catalogProjects, brand, areaLabel, sidebarFooter, actions, children }: {
  groups: SidebarGroup[];
  workflow: SidebarItem[];
  projects: Project[];
  catalogProjects: Array<Pick<Project, "id" | "name">>;
  brand: ReactNode;
  areaLabel: string;
  sidebarFooter: ReactNode;
  actions: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const [isReturning, startReturning] = useTransition();
  const section = workflow.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
  const match = section ?? groups.flatMap((group) => group.items).find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
  const detailId = /^\/projects\/(\d+)$/.exec(pathname)?.[1];
  const projectParams = params.getAll("project");
  const selectedId = detailId ?? (section && projectParams.length === 1 ? projectParams[0] : undefined);
  const project = projects.find((item) => item.id === Number(selectedId));
  const catalogProject = detailId ? catalogProjects.find((item) => item.id === Number(detailId)) : undefined;
  const returnPath = safeOverviewReturnPath(params.get("returnTo"));
  const catalogView = pathname === "/overview" ? safeOverviewReturnPath(`/overview?${params}`) : undefined;
  useEffect(() => {
    if (!catalogView) return;
    try { sessionStorage.setItem(catalogViewKey, catalogView); } catch { /* storage can be unavailable */ }
  }, [catalogView]);
  const visibleGroups = project ? [{
    label: "软件包流程",
    items: workflow.map((item) => ({
      ...item,
      href: workflowHref(item.href, project.id, { returnTo: returnPath, view: project.status === "ARCHIVED" && item.href === "/integration" ? "history" : undefined }),
    })),
  }] : catalogProject ? [] : groups;
  const filters = section?.href === pathname ? { view: params.get("view") ?? undefined, q: params.get("q") ?? undefined } : undefined;
  const crumbs: Crumb[] = [];

  if (detailId || project) {
    if (project) crumbs.push({ label: project.name, href: section ? `/projects/${project.id}` : undefined });
    else crumbs.push({ label: catalogProject?.name ?? "项目详情" });
  }

  if (match && (!project || section) && pathname !== "/dashboard") {
    const detail = pathname !== match.href && match.href !== "/projects";
    crumbs.push({ label: match.label, href: detail ? workflowHref(match.href, project?.id) : undefined });
    if (detail) {
      const label = pathname === "/submissions/transfer" ? "提交转测申请"
        : pathname === "/settings/packages/import" ? "导入历史版本"
        : pathname === "/integration/new" ? "准备转测批次"
        : /^\/integration\/\d+\/compare$/.test(pathname) ? "批次对比"
        : detailLabels[match.href] ?? "详情";
      crumbs.push({ label });
    }
  }

  return (
    <div className="workspace">
      <a href="#workspace-main-content" className="workspace-skip-link">跳到页面内容</a>
      <aside className="sidebar" aria-label="主导航">
        {brand}
        <SidebarNav groups={visibleGroups} />
        {sidebarFooter}
      </aside>
      <div className="workspace-main">
        <header className="workspace-navigation">
          <div className="topbar">
            <div className="topbar-location">
              {visibleGroups.length > 0 && <MobileWorkspaceMenu key={project?.id ?? "global"} groups={visibleGroups} areaLabel={areaLabel} />}
              {(detailId || project) && <Link href={returnPath ?? "/overview"} prefetch={false} className="topbar-project-back" aria-label="项目总览" onClick={(event) => {
                if (returnPath || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                let previous: string | undefined;
                try { previous = safeOverviewReturnPath(sessionStorage.getItem(catalogViewKey)); } catch { /* storage can be unavailable */ }
                if (!previous || previous === "/overview") return;
                event.preventDefault();
                startReturning(() => router.push(previous));
              }}>
                <span className="workspace-back-icon">
                  <ArrowLeft size={15} aria-hidden="true" />
                  <NavigationPending transitionPending={isReturning} />
                </span>
                <span>项目总览</span>
              </Link>}
              {crumbs.length > 0 && <Breadcrumb items={crumbs} />}
            </div>
            <div className="topbar-right">
              {section && !project && projects.length > 0 && (
                <FormDialog label={<><ChevronsUpDown size={15} aria-hidden="true" /> 按项目查看</>} title="按项目查看" triggerClassName="button button-secondary button-sm" cancelLabel="取消">
                  <ProjectChoices projects={projects} section={section} filters={filters} />
                </FormDialog>
              )}
              {actions}
            </div>
          </div>
        </header>
        <main id="workspace-main-content" className="workspace-content" tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
}
