"use client";

import { useId } from "react";
import { PACKAGE_STATUS_META } from "@/lib/constants";
import type { getPackageDeactivationBlockingVersions } from "@/lib/settings";
import { GuidanceDialog } from "./guidance-dialog";

export type PackageDeactivationBlockers = ReturnType<typeof getPackageDeactivationBlockingVersions>;

export function SettingsPackageActivation({ active, blockers, className }: {
  active: boolean;
  blockers: PackageDeactivationBlockers;
  className?: string;
}) {
  const hintId = useId();
  return (
    <div className={className ?? "field"}>
      {active && blockers.length > 0 ? (
        <>
          <input type="hidden" name="isActive" value="on" />
          <div className="toolbar">
            <span className="small muted">软件包已启用</span>
            <GuidanceDialog label="停用软件包" title="停用软件包"
              description="以下版本记录限制停用。"
              items={blockers.map((version) => ({
                title: `${version.version} · ${PACKAGE_STATUS_META[version.status].label}`,
                detail: version.status === "VOID" || version.isStandaloneImport
                  ? "这是保留的历史记录。请由管理员核对该软件包的停用条件。"
                  : "请打开版本全链路，查看处理当前版本的入口。",
                href: `/versions/${version.id}`,
                actionLabel: "查看版本全链路",
              }))}
              triggerClassName="button button-secondary button-sm" />
          </div>
        </>
      ) : (
        <>
          <label className="check-item" style={{ maxWidth: 280 }}>
            <input type="checkbox" name="isActive" defaultChecked={active} aria-describedby={hintId} />
            启用软件包
          </label>
          <span id={hintId} className="small muted">停用后禁止提交新版本，历史版本保留。</span>
        </>
      )}
    </div>
  );
}
