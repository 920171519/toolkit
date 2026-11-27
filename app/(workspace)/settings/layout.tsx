import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth";
import { getLedAreaIds, getManagedProjectIdsForUser } from "@/lib/access";
import { SettingsTabs } from "@/components/settings-tabs";
import "./settings.css";

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN";
  return (
    <div className="settings-content">
      <SettingsTabs
        isAdmin={isAdmin}
        canManageProjects={isAdmin || getManagedProjectIdsForUser(user.id).length > 0}
        canManagePackages={isAdmin || getLedAreaIds(user.id).length > 0}
      />
      {children}
    </div>
  );
}
