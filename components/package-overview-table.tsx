"use client";

import { useMemo, useState } from "react";
import { ArrowUpRight, Search } from "lucide-react";
import type { PackageOverviewRow, PersonOption } from "@/lib/queries";
import { Badge, EmptyState, StatusPill } from "@/components/ui";
import { PackageDrawer } from "@/components/package-drawer";

function syncOpenParam(packageId: number | null) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (packageId) url.searchParams.set("open", String(packageId));
  else url.searchParams.delete("open");
  window.history.replaceState(null, "", url.toString());
}

export function PackageOverviewTable({
  packages,
  people,
  initialOpenId,
  scopeLabel = "全部",
}: {
  packages: PackageOverviewRow[];
  people: PersonOption[];
  initialOpenId?: number;
  scopeLabel?: string;
}) {
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<number | null>(initialOpenId ?? null);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return packages;
    return packages.filter((pkg) =>
      [
        pkg.name,
        pkg.code,
        pkg.ownerName ?? "",
        pkg.areaName ?? "",
        pkg.formalVersion ?? "",
        ...pkg.usages.flatMap((usage) => [usage.projectName, ...usage.nodeNames]),
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [packages, query]);

  function openPackage(packageId: number) {
    setOpenId(packageId);
    syncOpenParam(packageId);
  }

  function closePackage() {
    setOpenId(null);
    syncOpenParam(null);
  }

  return (
    <div>
      <div className="toolbar-spread" style={{ marginBottom: 14 }}>
        <div className="stage-tabs">
          <span className="stage-tab" data-active="true">
            {scopeLabel} · {packages.length}
          </span>
        </div>
        <label className="input" style={{ width: 280, display: "flex", alignItems: "center", gap: 7, minHeight: 34, background: "var(--surface)" }}>
          <Search size={13} style={{ color: "var(--muted-light)", flex: "none" }} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索软件包、责任人或使用项目"
            aria-label="搜索软件包"
            style={{ border: 0, outline: 0, width: "100%", background: "transparent" }}
          />
        </label>
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        {filtered.length === 0 ? (
          <EmptyState title="没有匹配的软件包" description="调整搜索关键词后重试。" />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>软件包</th>
                  <th>责任田 / 责任人</th>
                  <th>使用范围</th>
                  <th>正式版</th>
                  <th>试制版</th>
                  <th>在途版本</th>
                  <th>状态</th>
                  <th aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((pkg) => (
                  <tr key={pkg.id}>
                    <td>
                      <button
                        type="button"
                        className="link-button"
                        style={{ fontWeight: 600, textAlign: "left" }}
                        onClick={() => openPackage(pkg.id)}
                      >
                        {pkg.name}
                      </button>
                      <div className="toolbar" style={{ gap: 5, marginTop: 2 }}>
                        <span className="small muted">{pkg.code}</span>
                        {!pkg.isActive && <Badge tone="slate">已停用</Badge>}
                      </div>
                    </td>
                    <td>
                      <div style={{ fontSize: 12 }}>{pkg.areaName ?? "未归属"}</div>
                      <div className="small muted">{pkg.ownerName ?? "责任人待指定"}</div>
                    </td>
                    <td className="usage-cell">
                      {pkg.usages.length === 0 ? (
                        <span className="small muted">未配置</span>
                      ) : (
                        <div className="usage-scope-list">
                          {pkg.usages.map((usage) => (
                            <div className="usage-scope-line" key={usage.projectId}>
                              <span>{usage.projectName}</span>
                              <span className="small muted">{usage.nodeNames.join(" / ")}</span>
                              {usage.projectStatus === "ARCHIVED" && <Badge tone="slate">存档</Badge>}
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td>
                      {pkg.formalVersion ? (
                        <span className="version-badge" style={{ color: "var(--brand)" }}>
                          {pkg.formalVersion}
                        </span>
                      ) : (
                        <span className="muted small">暂无</span>
                      )}
                    </td>
                    <td>
                      {pkg.trialVersions.length > 0 ? (
                        <div className="version-stack">
                          {pkg.trialVersions.map((version) => (
                            <span className="version-badge" style={{ color: "var(--teal)" }} key={version}>{version}</span>
                          ))}
                        </div>
                      ) : (
                        <span className="muted small">—</span>
                      )}
                    </td>
                    <td>
                      {pkg.currentVersion ? (
                        <div>
                          <span className="version-badge">{pkg.currentVersion}</span>
                          {pkg.inTestVersion && pkg.inTestVersion !== pkg.currentVersion && (
                            <div className="small muted">在测 {pkg.inTestVersion}</div>
                          )}
                          {pkg.pendingTransferVersion && pkg.pendingTransferVersion !== pkg.currentVersion && (
                            <div className="small muted">待转测 {pkg.pendingTransferVersion}</div>
                          )}
                        </div>
                      ) : (
                        <span className="muted small">—</span>
                      )}
                    </td>
                    <td>
                      {pkg.currentStatus ? (
                        <StatusPill status={pkg.currentStatus} />
                      ) : (
                        <Badge tone="emerald" dot>
                          已全量转正
                        </Badge>
                      )}
                    </td>
                    <td className="cell-actions">
                      <button
                        type="button"
                        className="archive-link"
                        onClick={() => openPackage(pkg.id)}
                        aria-label={`查看 ${pkg.name} 详情`}
                      >
                        详情 <ArrowUpRight size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="page-footnote">
        “试制版本”会同时展示一个软件包当前所有处于试制验证或待转正的版本；使用范围只展示在行项目，已归档项目的软件包记录请到项目视图的存档项目中查看。
      </p>

      {openId && (
        <PackageDrawer packageId={openId} people={people} onClose={closePackage} />
      )}
    </div>
  );
}
