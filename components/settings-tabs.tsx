"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function SettingsTabs({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname();
  if (items.length === 1) return null;
  return (
    <nav className="settings-tabs" aria-label="配置分类">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        return <Link key={item.href} className="settings-tab" href={item.href} prefetch={false} data-active={active} aria-current={active ? "page" : undefined}>{item.label}</Link>;
      })}
    </nav>
  );
}
