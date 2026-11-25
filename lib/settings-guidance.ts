import "server-only";

import { canManagePackageArea } from "./access";
import { packageIdentity } from "./package-identity";
import type { PersonOption } from "./queries";
import type { getSettingsPackageReferences } from "./settings";
import type { SessionUser } from "./types";

export function getNodeCandidateGuidance(actor: SessionUser, candidateCount: number) {
  if (candidateCount >= 2) return null;
  return {
    title: candidateCount === 0 ? "没有启用的候选账号" : "只有一个启用的候选账号",
    detail: actor.role === "ADMIN"
      ? "绑定验证责任人和主审批人需由不同账号担任。请先启用其他账号。"
      : "绑定验证责任人和主审批人需由不同账号担任。请联系管理员启用其他账号。",
    href: actor.role === "ADMIN" ? "/settings/users" : undefined,
    actionLabel: "查看人员与角色",
  };
}

export function getProjectManagerCandidateGuidance(actor: SessionUser, people: readonly PersonOption[]) {
  if (people.some(({ role }) => role === "SOFTWARE_MANAGER")) return null;
  return {
    title: "没有启用的软件经理账号",
    detail: actor.role === "ADMIN"
      ? "项目须指定至少一位软件经理。请先启用相应账号，或为人员设置软件经理角色。"
      : "项目须指定至少一位软件经理。请联系管理员启用相应账号或调整人员角色。",
    href: actor.role === "ADMIN" ? "/settings/users" : undefined,
    actionLabel: "配置人员角色",
  };
}

export function packageReferenceGuidance(
  actor: SessionUser,
  packages: ReturnType<typeof getSettingsPackageReferences>,
  detail: string,
  target: "usage" | "owner",
) {
  return packages.map((pkg) => {
    const { code, name } = packageIdentity(pkg);
    const canManage = canManagePackageArea(actor, pkg.areaId);
    return {
      title: code === name ? code : `${code} · ${name}`,
      detail: canManage ? detail
        : pkg.areaName ? `请联系${pkg.areaName}主管处理此软件包。` : "请联系系统管理员处理此软件包。",
      href: canManage ? `/settings/packages/${pkg.id}${target === "usage" ? "#package-usage" : "#package-responsibility"}`
        : pkg.areaId ? `/settings/areas/${pkg.areaId}` : undefined,
      actionLabel: canManage ? (target === "usage" ? "查看使用范围" : "转交责任人") : "查看责任田",
    };
  });
}
