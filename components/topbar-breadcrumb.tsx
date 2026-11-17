"use client";

import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

const routeLabels: Array<[string, string]> = [
  ["/dashboard", "我的工作台"],
  ["/overview", "部门总览"],
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

export function TopbarBreadcrumb() {
  const pathname = usePathname();
  const match = routeLabels.find(
    ([path]) => pathname === path || pathname.startsWith(path + "/"),
  );
  let label = match?.[1] ?? "部门总览";
  if (pathname.includes("/integration/") && pathname !== "/integration" && pathname !== "/integration/new") label = "转测批次详情";
  if (pathname.includes("/trial/") && pathname !== "/trial") label = "绑定验证详情";
  if (pathname.includes("/packages/") && pathname !== "/packages") label = "软件包详情";
  if (pathname.includes("/settings/packages/") && pathname !== "/settings/packages") label = "软件包配置详情";
  return (
    <div className="breadcrumb">
      <span>部门工作台</span>
      <ChevronRight size={11} />
      <strong>{label}</strong>
    </div>
  );
}
