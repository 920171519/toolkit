import "server-only";

import { canManagePackageArea, canManageProjectWorkflowForProject, getTransferAreaIds } from "./access";
import { all, one } from "./db";
import { getTransferPackageOptions } from "./queries";
import type { SessionUser } from "./types";
import { workflowHref } from "./workflow-links";

export function getActiveTransferProjects(packageId: number) {
  return all<{ id: number; name: string }>(
    `SELECT DISTINCT p.id, p.name
     FROM package_usages u JOIN projects p ON p.id = u.project_id
     WHERE u.package_id = ? AND p.status != 'ARCHIVED'
     ORDER BY p.sort_order, p.id`,
    packageId,
  );
}

export function canSubmitTransferForArea(user: SessionUser, areaId: number | null) {
  const areaIds = getTransferAreaIds(user);
  return areaIds === null || (areaId !== null && areaIds.includes(areaId));
}

type TransferGuidanceItem = { title: string; detail?: string; href?: string; actionLabel?: string };

export function getTransferEntryGuidance(
  user: SessionUser,
  projectId?: number,
  packageId?: number,
): TransferGuidanceItem[] {
  const project = projectId === undefined ? undefined : one<{ status: string }>("SELECT status FROM projects WHERE id = ?", projectId);
  if (project?.status === "ARCHIVED") return [{
    title: "当前项目已归档",
    detail: "从仍在行的项目发起转测。",
    href: "/overview",
    actionLabel: "查看项目总览",
  }];

  if (packageId !== undefined) {
    const pkg = one<{ areaId: number | null; areaName: string | null; active: number }>(
      `SELECT p.area_id AS areaId, a.name AS areaName, p.is_active AS active
       FROM packages p LEFT JOIN areas a ON a.id = p.area_id WHERE p.id = ?`,
      packageId,
    );
    if (!pkg) return [{ title: "软件包不可用", href: workflowHref("/packages", projectId), actionLabel: "返回软件版本总览" }];
    const canConfigure = canManagePackageArea(user, pkg.areaId);
    const configHref = canConfigure ? `/settings/packages/${packageId}` : undefined;
    const projects = getActiveTransferProjects(packageId);
    const items: TransferGuidanceItem[] = [];
    if (!canSubmitTransferForArea(user, pkg.areaId)) items.push({
      title: pkg.areaName ? `由「${pkg.areaName}」责任田人员提交` : "软件包尚未归属责任田",
      detail: pkg.areaName ? "联系责任田主管安排提交或分配职责。" : "请管理员先配置软件包责任田。",
      href: pkg.areaId ? `/settings/areas/${pkg.areaId}` : undefined,
      actionLabel: "查看责任田分工",
    });
    if (!pkg.active) items.push({
      title: "软件包已停用",
      detail: canConfigure ? "核对状态后，可在软件包配置中启用。" : "联系责任田主管核对软件包状态。",
      href: configHref,
      actionLabel: "查看软件包配置",
    });
    if (projects.length === 0) items.push({
      title: "没有在行项目的使用节点",
      detail: "需要为软件包关联至少一个在行项目的测试节点。",
      href: configHref ? `${configHref}#package-usage` : undefined,
      actionLabel: "配置使用范围",
    });
    else if (projectId !== undefined && !projects.some(({ id }) => id === projectId)) items.push({
      title: "当前项目不使用该软件包",
      detail: "从全局提交页选择该包，申请将发送给实际使用的在行项目。",
      href: canSubmitTransferForArea(user, pkg.areaId) && pkg.active ? workflowHref("/submissions/transfer", undefined, { package: packageId }) : undefined,
      actionLabel: "切换到全局转测",
    });
    return items;
  }

  if (getTransferAreaIds(user)?.length === 0) return [{
    title: "账号尚未分配责任田职责",
    detail: "由责任田主管或管理员分配后，可提交该责任田内的软件包。",
    href: "/settings/areas",
    actionLabel: "查看责任田分工",
  }];
  if (projectId !== undefined && getTransferPackageOptions(user).length > 0) return [{
    title: "当前项目没有可提交的软件包",
    detail: "在全局提交页可以选择其他在行项目实际使用的软件包。",
    href: "/submissions/transfer",
    actionLabel: "切换到全局转测",
  }];
  if (user.role === "ADMIN" || (projectId !== undefined && canManageProjectWorkflowForProject(user, projectId))) return [{
    title: "当前范围没有启用且已关联在行测试节点的软件包",
    detail: "检查软件包是否已启用，并检查项目测试节点及软件包使用范围。",
    href: user.role === "ADMIN" ? "/settings/packages" : `/settings/projects/${projectId}`,
    actionLabel: user.role === "ADMIN" ? "查看软件包配置" : "查看项目测试节点",
  }];
  return [{
    title: "责任田范围内没有可提交的软件包",
    detail: "请责任田主管检查软件包是否已启用，以及是否配置了在行项目测试节点。",
    href: "/settings/areas",
    actionLabel: "查看责任田分工",
  }];
}
