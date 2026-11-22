"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { findWorkspaceProject } from "./workspace-project";

const overviewQueryKeys = new Set(["q", "page", "pageSize", "f_name", "f_name_mode", "f_code", "f_code_mode", "f_stage", "f_pm", "f_manager"]);

const routeLabels: Array<[string, string]> = [
  ["/dashboard", "我的工作台"],
  ["/overview", "项目总览"],
  ["/packages", "软件版本总览"],
  ["/submissions", "待转测申请"],
  ["/integration", "集成测试"],
  ["/trial", "试制与绑定验证"],
  ["/formal", "转正发布"],
  ["/projects", "项目工作区"],
  ["/versions", "版本全链路"],
  ["/settings/areas", "责任田配置"],
  ["/settings/projects", "项目配置"],
  ["/settings/packages", "软件包配置"],
  ["/settings/users", "人员与角色"],
];

export function TopbarBreadcrumb({
  workflowPaths,
  workflowProjects,
  catalogProjects,
}: {
  workflowPaths: string[];
  workflowProjects: { id: number; name: string }[];
  catalogProjects: { id: number; name: string }[];
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const isProjectPage = /^\/projects\/\d+$/.test(pathname);
  const returnQuery = new URLSearchParams(isProjectPage ? params.get("overviewQuery") ?? "" : "");
  const overviewQuery = new URLSearchParams(
    [...returnQuery].filter(([key]) => overviewQueryKeys.has(key)),
  ).toString();
  const overviewHref = overviewQuery ? "/overview?" + overviewQuery : "/overview";
  const project = findWorkspaceProject(pathname, params.getAll("project"), workflowPaths, isProjectPage ? catalogProjects : workflowProjects);
  const match = routeLabels.find(
    ([path]) => pathname === path || pathname.startsWith(path + "/"),
  );
  let label = match?.[1] ?? "项目总览";
  if (pathname.includes("/integration/") && pathname !== "/integration" && pathname !== "/integration/new") label = "转测批次详情";
  if (pathname.includes("/trial/") && pathname !== "/trial") label = "绑定验证详情";
  if (pathname.includes("/packages/") && pathname !== "/packages") label = "软件包详情";
  if (pathname === "/settings/packages/import") label = "导入历史版本";
  else if (pathname.includes("/settings/packages/") && pathname !== "/settings/packages") label = "软件包配置详情";
  if (project) {
    return (
      <nav className="breadcrumb project-breadcrumb" aria-label="项目导航">
        {isProjectPage ? <strong>{project.name}</strong> : (
          <Link className="project-breadcrumb-name" href={"/projects/" + project.id} prefetch={false}>{project.name}</Link>
        )}
        <ChevronRight size={11} aria-hidden="true" />
        {!isProjectPage && <span className="project-breadcrumb-section">{label}</span>}
        <Link href={overviewHref} className="project-breadcrumb-return" prefetch={false}>返回项目总览</Link>
      </nav>
    );
  }
  return (
    <div className="breadcrumb">
      <span>部门工作台</span>
      <ChevronRight size={11} />
      <strong>{label}</strong>
    </div>
  );
}
