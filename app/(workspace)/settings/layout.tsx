import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth";
import { getSettingsNavigation } from "@/lib/settings-navigation";
import { SettingsTabs } from "@/components/settings-tabs";
import "./settings.css";

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const items = getSettingsNavigation(user).map((item) => ({
    href: item.href,
    label: "tabLabel" in item ? item.tabLabel : item.label,
  }));
  return (
    <div className="settings-content">
      <SettingsTabs items={items} />
      {children}
    </div>
  );
}
