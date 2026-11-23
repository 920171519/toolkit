"use client";

import { type MouseEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Search } from "lucide-react";
import type { PackageOverviewRow, PersonOption } from "@/lib/queries";
import { columnFilterKeys, filterOptions, matchesChoiceFilter, matchesTextFilter, readColumnFilters, type ColumnFilterField } from "@/lib/column-filters";
import { matchesDirectorySearch } from "@/lib/settings-directory";
import { ColumnFilterHeader } from "@/components/column-filter-header";
import { PACKAGE_STATUS_META } from "@/lib/constants";
import { DEFAULT_LIST_PAGE_SIZE, getListPageSize, LIST_PAGE_SIZES } from "@/lib/list-pagination";
import { packageIdentity } from "@/lib/package-identity";
import { EmptyState } from "@/components/ui";
import { PackageDrawer, type DrawerPayload } from "@/components/package-drawer";
import identityStyles from "./package-identity.module.css";

const path = "/packages";
const empty = "_empty";
type DetailPanel = "overview" | "usage";

function nodeOptionValue(name: string) {
  const bytes = new TextEncoder().encode(name);
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function PackageOverviewTable({
  packages, people, transferableIds, initialDetail = null, selectedProjectId,
}: {
  packages: PackageOverviewRow[];
  people: PersonOption[];
  transferableIds: number[];
  initialDetail?: DrawerPayload | null;
  selectedProjectId?: number;
}) {
  const params = useSearchParams();
  const query = params.get("q") ?? "";
  const requestedId = Number(params.get("open"));
  const openId = Number.isSafeInteger(requestedId) && requestedId > 0 ? requestedId : null;
  const openPanel = params.get("panel") === "usage" ? "usage" : "overview";
  const usages = packages.flatMap((pkg) => pkg.usages);
  const fields = {
    name: { key: "name", label: "软件包名称", kind: "text" },
    code: { key: "code", label: "软件包编码", kind: "text" },
    area: { key: "area", label: "责任田", kind: "choices", options: filterOptions(packages.map((pkg) => ({
      value: String(pkg.areaId ?? empty),
      label: pkg.areaName ?? "未归属",
    }))) },
    owner: { key: "owner", label: "责任人", kind: "choices", options: filterOptions(packages.map((pkg) => ({
      value: String(pkg.ownerId ?? empty),
      label: [pkg.ownerName, pkg.ownerEmployeeId].filter(Boolean).join(" · ") || "责任人待指定",
    }))) },
    project: { key: "usage_project", label: "使用项目", kind: "choices", options: filterOptions(usages.map((usage) => ({
      value: String(usage.projectId),
      label: usage.projectName,
    }))) },
    node: { key: "usage_node", label: "使用节点", kind: "choices", options: filterOptions(usages.flatMap((usage) => usage.nodeNames.map((name) => ({
      value: nodeOptionValue(name),
      label: name,
    })))) },
    formal: { key: "formal", label: "正式版本", kind: "text" },
    trial: { key: "trial", label: "试制版本", kind: "text" },
    current: { key: "current", label: "在途版本", kind: "text" },
    status: { key: "status", label: "状态", kind: "choices", options: filterOptions(packages.map((pkg) => ({
      value: pkg.currentStatus ?? (pkg.formalVersion ? "FORMAL_ONLY" : empty),
      label: pkg.currentStatus ? PACKAGE_STATUS_META[pkg.currentStatus]?.label ?? pkg.currentStatus : pkg.formalVersion ? "无在途版本" : "暂无版本",
    }))) },
  } satisfies Record<string, ColumnFilterField>;
  const filters = readColumnFilters(Object.fromEntries(params), Object.values(fields));
  const filterSet = Boolean(query || Object.keys(filters).length);
  const header = { path, params: { project: selectedProjectId?.toString(), ...filters, q: query || undefined, pageSize: params.get("pageSize") ?? undefined } };
  const filtered = packages.map((pkg) => ({ pkg, identity: packageIdentity(pkg) })).filter(({ pkg, identity }) => {
    const usageMatches = !(filters.f_usage_project || filters.f_usage_node) || pkg.usages.some((usage) =>
      matchesChoiceFilter(filters, "usage_project", [String(usage.projectId)]) &&
      matchesChoiceFilter(filters, "usage_node", usage.nodeNames.map(nodeOptionValue)));
    return usageMatches &&
      (matchesTextFilter(filters, "name", identity.name) || matchesTextFilter(filters, "name", pkg.name)) &&
      (matchesTextFilter(filters, "code", identity.code) || matchesTextFilter(filters, "code", pkg.code)) &&
      matchesChoiceFilter(filters, "area", [String(pkg.areaId ?? empty)]) &&
      matchesChoiceFilter(filters, "owner", [String(pkg.ownerId ?? empty)]) &&
      matchesTextFilter(filters, "formal", pkg.formalVersion) &&
      (!filters.f_trial || pkg.trialVersions.some((version) => matchesTextFilter(filters, "trial", version))) &&
      [pkg.currentVersion, pkg.inTestVersion, pkg.pendingTransferVersion].some((version) => matchesTextFilter(filters, "current", version)) &&
      matchesChoiceFilter(filters, "status", [pkg.currentStatus ?? (pkg.formalVersion ? "FORMAL_ONLY" : empty)]) &&
      matchesDirectorySearch(query, pkg.name, pkg.code, pkg.ownerName, pkg.areaName, pkg.formalVersion,
        pkg.currentVersion, pkg.inTestVersion, pkg.pendingTransferVersion, ...pkg.trialVersions,
        ...pkg.usages.flatMap((usage) => [usage.projectName, usage.projectCode, ...usage.nodeNames]));
  });
  const pageSize = getListPageSize(params.get("pageSize"));
  const lastPage = Math.max(1, Math.ceil(filtered.length / pageSize));
  const requestedPage = Number(params.get("page"));
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, lastPage) : 1;
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);

  function urlWith(entries: Record<string, string | number | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(entries)) {
      if (value === "" || value === null) next.delete(key);
      else next.set(key, String(value));
    }
    return next.size ? "/packages?" + next.toString() : "/packages";
  }

  function applyColumnFilter(columns: ColumnFilterField[], values: Record<string, string>) {
    const cleared = Object.fromEntries(columns.flatMap(columnFilterKeys).map((key) => [key, null]));
    window.history.pushState(null, "", urlWith({ ...cleared, ...values, page: null }));
  }

  function resetFilters() {
    const cleared = Object.fromEntries(Object.values(fields).flatMap(columnFilterKeys).map((key) => [key, null]));
    window.history.replaceState(null, "", urlWith({ ...cleared, q: null, page: null }));
  }

  function openPackage(event: MouseEvent<HTMLAnchorElement>, id: number, panel: DetailPanel = "overview") {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    window.history.pushState({ toolkitPackageDrawer: id }, "", urlWith({ open: id, panel: panel === "usage" ? panel : null }));
  }

  function closePackage() {
    if (window.history.state?.toolkitPackageDrawer === openId) window.history.back();
    else window.history.replaceState(null, "", urlWith({ open: null, panel: null }));
  }

  const column = (label: string, columns: ColumnFilterField[]) => (
    <ColumnFilterHeader {...header} label={label} fields={columns} onFilterChange={(values) => applyColumnFilter(columns, values)} />
  );

  return (
    <>
      <section className="card package-index" aria-label="软件包列表">
        <div className="package-index-toolbar">
          <label className="workspace-search">
            <Search size={16} aria-hidden="true" />
            <input type="search" value={query} onChange={(event) => window.history.replaceState(null, "", urlWith({ q: event.target.value, page: null }))} aria-label="搜索软件包" placeholder="搜索软件包、版本或责任人" />
          </label>
          <span className="small muted" role="status">{filtered.length}{filterSet ? " / " + packages.length : ""} 个软件包</span>
          {filterSet && <button type="button" className="button button-ghost button-sm" onClick={resetFilters}>清除筛选</button>}
        </div>
          <div className="table-wrap" role="region" aria-label="软件版本总览表格" tabIndex={0}>
            <table className="data-table">
              <thead>
                <tr>
                  {column("软件包", [fields.name, fields.code])}
                  {column("责任田 / 责任人", [fields.area, fields.owner])}
                  {column("使用范围", [fields.project, fields.node])}
                  {column("正式版", [fields.formal])}
                  {column("试制 / 待转正", [fields.trial])}
                  {column("在途版本", [fields.current])}
                  {column("状态", [fields.status])}
                </tr>
              </thead>
              <tbody>
                {visible.map(({ pkg, identity: { code, name } }) => {
                  const href = urlWith({ open: pkg.id, panel: null });
                  return (
                    <tr key={pkg.id}>
                      <th scope="row" className="package-index-name">
                        <Link href={href} className={`mono link-button ${identityStyles.code}`} prefetch={false} onClick={(event) => openPackage(event, pkg.id)} aria-label={`查看 ${code} 详情`}>{code}<ArrowRight size={12} aria-hidden="true" /></Link>
                        {name !== code && <div className={identityStyles.tableName} title={name}>{name}</div>}
                        {!pkg.isActive && <div className="small muted">已停用</div>}
                      </th>
                      <td>{pkg.areaName ?? "未归属"}<div className="small muted">{pkg.ownerName ?? "责任人待指定"}</div></td>
                      <td className="package-index-usage">
                        {pkg.usages.length === 0 ? <span className="small muted">未配置</span> : (
                          <>
                            <ul className="package-scope-projects">
                              {pkg.usages.map((usage) => <li key={usage.projectId}>{usage.projectName}</li>)}
                            </ul>
                            <Link href={urlWith({ open: pkg.id, panel: "usage" })} prefetch={false} className="archive-link package-scope-action"
                              aria-label={`查看 ${code} 使用范围`} onClick={(event) => openPackage(event, pkg.id, "usage")}>查看节点</Link>
                          </>
                        )}
                      </td>
                      <td>{pkg.formalVersion ? <span className="version-badge whitespace-nowrap">{pkg.formalVersion}</span> : <span className="muted small">—</span>}</td>
                      <td>{pkg.trialVersions.length ? <ul className="version-stack whitespace-nowrap">{pkg.trialVersions.map((version) => <li className="version-badge" key={version}>{version}</li>)}</ul> : <span className="muted small">—</span>}</td>
                      <td>{pkg.currentVersion ? <><span className="version-badge whitespace-nowrap">{pkg.currentVersion}</span>{pkg.inTestVersion && pkg.inTestVersion !== pkg.currentVersion && <div className="small muted">在测 {pkg.inTestVersion}</div>}{pkg.pendingTransferVersion && pkg.pendingTransferVersion !== pkg.currentVersion && <div className="small muted">待转测 {pkg.pendingTransferVersion}</div>}</> : <span className="muted small">—</span>}</td>
                      <td>{pkg.currentStatus ? (PACKAGE_STATUS_META[pkg.currentStatus]?.label ?? pkg.currentStatus) : <span className="muted small">{pkg.formalVersion ? "无在途版本" : "暂无版本"}</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        {visible.length === 0 && <EmptyState title={filterSet ? "没有匹配的软件包" : "暂无软件包"} />}
        <div className="package-index-pagination">
          <label>
            <span>每页行数</span>
            <select className="select" aria-label="每页行数" value={pageSize} onChange={(event) => {
              const size = getListPageSize(event.target.value);
              window.history.pushState(null, "", urlWith({ page: null, pageSize: size === DEFAULT_LIST_PAGE_SIZE ? null : size }));
            }}>
              {LIST_PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
          <nav aria-label="软件包分页">
            {page > 1 && <Link href={urlWith({ page: page - 1 === 1 ? null : page - 1 })} prefetch={false} className="button button-secondary button-sm">上一页</Link>}
            <span>第 {page} / {lastPage} 页</span>
            {page < lastPage && <Link href={urlWith({ page: page + 1 })} prefetch={false} className="button button-secondary button-sm">下一页</Link>}
          </nav>
        </div>
      </section>
      {openId && <PackageDrawer key={`${openId}-${openPanel}`} packageId={openId} projectId={selectedProjectId} people={people} canSubmitTransfer={transferableIds.includes(openId)} onClose={closePackage} initialDetail={initialDetail?.package.id === openId ? initialDetail : null} initialPanel={openPanel} />}
    </>
  );
}
