import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { PackageOverviewRow } from "@/lib/queries";
import { filterOptions, matchesChoiceFilter, matchesTextFilter, readColumnFilters, type ColumnFilterField } from "@/lib/column-filters";
import { PACKAGE_STATUS_META } from "@/lib/constants";
import { directoryHref, directoryValue, matchesDirectorySearch, type DirectoryParams } from "@/lib/settings-directory";
import { ColumnFilterHeader } from "@/components/column-filter-header";
import { DirectoryFilterBar } from "@/components/settings-directory";
import { Badge, EmptyState, StatusPill } from "@/components/ui";

const path = "/packages";
const empty = "_empty";

function nodeOptionValue(name: string) {
  return Buffer.from(name).toString("base64url");
}

export function PackageOverviewTable({
  packages,
  params,
  selectedProjectId,
}: {
  packages: PackageOverviewRow[];
  params: DirectoryParams;
  selectedProjectId?: number;
}) {
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
      value: pkg.currentStatus ?? empty,
      label: pkg.currentStatus ? PACKAGE_STATUS_META[pkg.currentStatus]?.label ?? pkg.currentStatus : "已全量转正",
    }))) },
  } satisfies Record<string, ColumnFilterField>;
  const filters = readColumnFilters(params, Object.values(fields));
  const query = directoryValue(params.q);
  const header = { path, params: { project: selectedProjectId?.toString(), ...filters, q: query || undefined } };
  const filtered = packages.filter((pkg) => {
    const usageMatches = !(filters.f_usage_project || filters.f_usage_node) || pkg.usages.some((usage) =>
      matchesChoiceFilter(filters, "usage_project", [String(usage.projectId)]) &&
      matchesChoiceFilter(filters, "usage_node", usage.nodeNames.map(nodeOptionValue)));
    return usageMatches &&
      matchesTextFilter(filters, "name", pkg.name) &&
      matchesTextFilter(filters, "code", pkg.code) &&
      matchesChoiceFilter(filters, "area", [String(pkg.areaId ?? empty)]) &&
      matchesChoiceFilter(filters, "owner", [String(pkg.ownerId ?? empty)]) &&
      matchesTextFilter(filters, "formal", pkg.formalVersion) &&
      (!filters.f_trial || pkg.trialVersions.some((version) => matchesTextFilter(filters, "trial", version))) &&
      [pkg.currentVersion, pkg.inTestVersion, pkg.pendingTransferVersion].some((version) => matchesTextFilter(filters, "current", version)) &&
      matchesChoiceFilter(filters, "status", [pkg.currentStatus ?? empty]) &&
      matchesDirectorySearch(query, pkg.name, pkg.code, pkg.ownerName, pkg.areaName, pkg.formalVersion,
        ...pkg.usages.flatMap((usage) => [usage.projectName, ...usage.nodeNames]));
  });

  return (
    <div>
      <section className="card" aria-labelledby="package-overview-list">
        <div className="card-header">
          <h2 id="package-overview-list">软件包列表</h2>
          <DirectoryFilterBar {...header} />
        </div>
        <div className="table-wrap" role="region" aria-label="软件版本总览表格" tabIndex={0}>
          <table className="data-table">
            <thead>
              <tr>
                <ColumnFilterHeader {...header} label="软件包" fields={[fields.name, fields.code]} />
                <ColumnFilterHeader {...header} label="责任田 / 责任人" fields={[fields.area, fields.owner]} />
                <ColumnFilterHeader {...header} label="使用范围" fields={[fields.project, fields.node]} />
                <ColumnFilterHeader {...header} label="正式版" fields={[fields.formal]} />
                <ColumnFilterHeader {...header} label="试制版" fields={[fields.trial]} />
                <ColumnFilterHeader {...header} label="在途版本" fields={[fields.current]} />
                <ColumnFilterHeader {...header} label="状态" fields={[fields.status]} />
                <th scope="col" aria-label="操作" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((pkg) => {
                const detailHref = directoryHref(path, { ...header.params, open: String(pkg.id) });
                return (
                  <tr key={pkg.id}>
                    <td>
                      <Link
                        href={detailHref}
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
                        href={detailHref}
                        className="archive-link"
                        prefetch={false}
                        aria-label={`查看 ${pkg.name} 详情`}
                      >
                        详情 <ArrowUpRight size={12} />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && <EmptyState title="没有匹配的软件包" description="可继续调整各列筛选条件。" />}
        {filtered.length > 0 && <p className="small muted" style={{ padding: "12px 16px" }} role="status">共 {filtered.length} 个软件包</p>}
      </section>
      <p className="page-footnote">
        “试制版本”会同时展示一个软件包当前所有处于试制验证或待转正的版本；使用范围只展示在行项目，已归档项目的软件包记录请到项目总览中查找已结束的项目。
      </p>
    </div>
  );
}
