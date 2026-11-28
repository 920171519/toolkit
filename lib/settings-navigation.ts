import "server-only";

import { cache } from "react";
import { getSettingsNavigationGrants } from "./access";
import type { SessionUser } from "./types";

const areas = { href: "/settings/areas", label: "责任田", icon: "areas" } as const;
const projects = { href: "/settings/projects", label: "项目配置", tabLabel: "项目与节点", icon: "projectSettings" } as const;
const packages = { href: "/settings/packages", label: "软件包配置", tabLabel: "软件包", icon: "packageSettings" } as const;
const users = { href: "/settings/users", label: "人员与角色", icon: "users" } as const;

export const getSettingsNavigation = cache((user: SessionUser) => {
  if (user.role === "ADMIN") return [areas, projects, packages, users];

  const { hasManagedProjects, hasLedAreas } = getSettingsNavigationGrants(user.id);
  return [
    areas,
    ...(hasManagedProjects ? [projects] : []),
    ...(hasLedAreas ? [packages] : []),
  ];
});
