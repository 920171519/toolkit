"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Search } from "lucide-react";
import type { PackageOverviewRow, PersonOption } from "@/lib/queries";
import { PACKAGE_STATUS_META } from "@/lib/constants";
import { Badge, EmptyState, StatusPill } from "@/components/ui";
import { PackageDrawer, type DrawerPayload } from "@/components/package-drawer";

function packageHref(packageId: number, projectId?: number) {
  return `/packages?open=${packageId}${projectId ? `&project=${projectId}` : ""}`;
}

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
  initialDetail = null,
  selectedProjectId,
}: {
  packages: PackageOverviewRow[];
  people: PersonOption[];
  initialOpenId?: number;
  scopeLabel?: string;
  initialDetail?: DrawerPayload | null;
  selectedProjectId?: number;
}) {
  const [query, setQuery] = useState("");
  const [nameFilter, setNameFilter] = useState("");
  const [areaFilter, setAreaFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [nodeFilter, setNodeFilter] = useState("");
  const [formalFilter, setFormalFilter] = useState("");
  const [trialFilter, setTrialFilter] = useState("");
  const [currentFilter, setCurrentFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [openId, setOpenId] = useState<number | null>(initialOpenId ?? null);

  const areas = useMemo(() => [...new Set(packages.map((pkg) => pkg.areaName).filter((item): item is string => Boolean(item)))].sort(), [packages]);
  const projects = useMemo(() => {
    const map = new Map<number, string>();
    for (const pkg of packages) for (const usage of pkg.usages) map.set(usage.projectId, usage.projectName);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], "zh-CN"));
  }, [packages]);
  const nodes = useMemo(() => [...new Set(packages.flatMap((pkg) => pkg.usages.flatMap((usage) => usage.nodeNames)))].sort(), [packages]);
  const statuses = useMemo(() => [...new Set(packages.map((pkg) => pkg.currentStatus).filter((item): item is NonNullable<typeof item> => Boolean(item)))], [packages]);

  const hasColumnFilter = Boolean(nameFilter || areaFilter || projectFilter || nodeFilter || formalFilter || trialFilter || currentFilter || statusFilter);
  function resetFilters() {
    setNameFilter(""); setAreaFilter(""); setProjectFilter(""); setNodeFilter("");
    setFormalFilter(""); setTrialFilter(""); setCurrentFilter(""); setStatusFilter("");
  }

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return packages.filter((pkg) => {
      const globalText = [pkg.name, pkg.code, pkg.ownerName ?? "", pkg.areaName ?? "", pkg.formalVersion ?? "", ...pkg.usages.flatMap((usage) => [usage.projectName, ...usage.nodeNames])].join(" ").toLowerCase();
      if (normalized && !globalText.includes(normalized)) return false;
      if (nameFilter && !`${pkg.name} ${pkg.code}`.toLowerCase().includes(nameFilter.toLowerCase())) return false;
      if (areaFilter && pkg.areaName !== areaFilter) return false;
      if (projectFilter && !pkg.usages.some((usage) => String(usage.projectId) === projectFilter)) return false;
      if (nodeFilter && !pkg.usages.some((usage) => usage.nodeNames.includes(nodeFilter))) return false;
      if (formalFilter && !(pkg.formalVersion ?? "").toLowerCase().includes(formalFilter.toLowerCase())) return false;
      if (trialFilter && !pkg.trialVersions.some((version) => version.toLowerCase().includes(trialFilter.toLowerCase()))) return false;
      if (currentFilter && !(pkg.currentVersion ?? "").toLowerCase().includes(currentFilter.toLowerCase())) return false;
      if (statusFilter && pkg.currentStatus !== statusFilter) return false;
      return true;
    });
  }, [packages, query, nameFilter, areaFilter, projectFilter, nodeFilter, formalFilter, trialFilter, currentFilter, statusFilter]);

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
                <tr className="package-filter-row">
                  <th><input className="input input-sm" value={nameFilter} onChange={(event) => setNameFilter(event.target.value)} placeholder="筛选包/编码" aria-label="筛选软件包" /></th>
                  <th><select className="select select-sm" value={areaFilter} onChange={(event) => setAreaFilter(event.target.value)} aria-label="筛选责任田"><option value="">全部责任田</option>{areas.map((area) => <option key={area} value={area}>{area}</option>)}</select></th>
                  <th><div style={{ display: "flex", gap: 4 }}><select className="select select-sm" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} aria-label="筛选使用项目"><option value="">全部项目</option>{projects.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select><select className="select select-sm" value={nodeFilter} onChange={(event) => setNodeFilter(event.target.value)} aria-label="筛选使用节点"><option value="">全部节点</option>{nodes.map((node) => <option key={node} value={node}>{node}</option>)}</select></div></th>
                  <th><input className="input input-sm" value={formalFilter} onChange={(event) => setFormalFilter(event.target.value)} placeholder="筛选正式版" aria-label="筛选正式版本" /></th>
                  <th><input className="input input-sm" value={trialFilter} onChange={(event) => setTrialFilter(event.target.value)} placeholder="筛选试制版" aria-label="筛选试制版本" /></th>
                  <th><input className="input input-sm" value={currentFilter} onChange={(event) => setCurrentFilter(event.target.value)} placeholder="筛选在途版本" aria-label="筛选在途版本" /></th>
                  <th><select className="select select-sm" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="筛选状态"><option value="">全部状态</option>{statuses.map((status) => <option key={status} value={status}>{PACKAGE_STATUS_META[status]?.label ?? status}</option>)}</select></th>
                  <th>{hasColumnFilter ? <button type="button" className="button button-ghost button-sm" onClick={resetFilters}>重置</button> : null}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((pkg) => (
                  <tr key={pkg.id}>
                    <td>
                      <Link
                        href={packageHref(pkg.id, selectedProjectId)}
                        className="link-button"
                        style={{ fontWeight: 600, textAlign: "left" }}
                        prefetch={false}
                      >
                        {pkg.name}
                      </Link>
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
                      <Link
                        href={packageHref(pkg.id, selectedProjectId)}
                        className="archive-link"
                        prefetch={false}
                        aria-label={`查看 ${pkg.name} 详情`}
                      >
                        详情 <ArrowUpRight size={12} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="page-footnote">
        “试制版本”会同时展示一个软件包当前所有处于试制验证或待转正的版本；使用范围只展示在行项目，已归档项目的软件包记录请到部门总览的存档项目中查看。
      </p>

      {openId && (
        <PackageDrawer packageId={openId} people={people} onClose={closePackage} initialDetail={initialDetail?.package.id === openId ? initialDetail : null} />
      )}
    </div>
  );
}
