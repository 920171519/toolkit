import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getLedAreaIds } from "@/lib/access";
import { filterOptions, matchesChoiceFilter, matchesNumberFilter, matchesTextFilter, readColumnFilters, type ColumnFilterField } from "@/lib/column-filters";
import { PACKAGE_STATUS_META } from "@/lib/constants";
import { getAdminPackages, getAreaConfigs, getPeople, parseFlash } from "@/lib/queries";
import { getListPageSize } from "@/lib/list-pagination";
import { packageIdentity, PACKAGE_CODE_EXAMPLE, PACKAGE_CODE_PATTERN } from "@/lib/package-identity";
import { savePackageAction } from "@/lib/actions/settings";
import { directoryHref, directoryPage, matchesDirectorySearch } from "@/lib/settings-directory";
import { ActionForm } from "@/components/action-form";
import { Badge, EmptyState, FlashMessage, PageHeader, StatusPill } from "@/components/ui";
import { ColumnFilterHeader } from "@/components/column-filter-header";
import { DirectoryFilterBar, DirectoryPagination } from "@/components/settings-directory";
import directoryStyles from "@/components/settings-directory.module.css";
import { SettingsTabs } from "@/components/settings-tabs";
import { FormDialog } from "@/components/form-dialog";
import styles from "./package-settings.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "软件包配置" };

const path = "/settings/packages";
const missing = "_empty";

export default async function PackagesSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN";
  const ledAreas = new Set(getLedAreaIds(user.id));
  if (!isAdmin && ledAreas.size === 0) {
    redirect(`/dashboard?flash=${encodeURIComponent("当前角色无权访问该页面")}&tone=error`);
  }
  const params = await searchParams;
  const notice = parseFlash(params.flash, params.tone === "error" ? "error" : "success");
  const areas = getAreaConfigs().filter((area) => isAdmin || ledAreas.has(area.id));
  const packages = getAdminPackages().filter((pkg) => isAdmin || (pkg.areaId !== null && ledAreas.has(pkg.areaId)));
  const people = getPeople();
  const areaOptions = areas.map((area) => ({ value: String(area.id), label: area.name }));
  if (packages.some((pkg) => pkg.areaId === null)) {
    areaOptions.push({ value: missing, label: "未归属" });
  }
  const ownerOptions = packages.map((pkg) => ({
    value: String(pkg.ownerId ?? missing),
    label: [pkg.ownerName, pkg.ownerEmployeeId].filter(Boolean).join(" · ") || "待指定",
  }));
  const progressOptions = packages.map((pkg) => ({
    value: pkg.currentStatus ?? missing,
    label: pkg.currentStatus ? PACKAGE_STATUS_META[pkg.currentStatus]?.label ?? pkg.currentStatus : "无在途流程",
  }));
  const fields = {
    code: { key: "code", label: "软件包编码", kind: "text" },
    name: { key: "name", label: "软件包名称", kind: "text" },
    area: { key: "area", label: "责任田", kind: "choices", options: filterOptions(areaOptions) },
    owner: { key: "owner", label: "责任人", kind: "choices", options: filterOptions(ownerOptions) },
    versions: { key: "versions", label: "版本记录", kind: "number" },
    nodes: { key: "nodes", label: "使用节点", kind: "number" },
    enabled: { key: "enabled", label: "启停状态", kind: "choices", options: [
      { value: "active", label: "启用" },
      { value: "inactive", label: "停用" },
    ] },
    progress: { key: "progress", label: "当前流程状态", kind: "choices", options: filterOptions(progressOptions) },
  } satisfies Record<string, ColumnFilterField>;

  const query = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const oldArea = areas.find((area) => String(area.id) === params.area);
  const oldState = params.state === "active" || params.state === "inactive" ? params.state : undefined;
  const filters = readColumnFilters({
    ...params,
    f_area: params.f_area ?? (oldArea ? String(oldArea.id) : undefined),
    f_enabled: params.f_enabled ?? oldState,
  }, Object.values(fields));
  const pageSize = getListPageSize(params.pageSize);
  const matching = packages.map((pkg) => ({ pkg, identity: packageIdentity(pkg) })).filter(({ pkg, identity }) => {
    return matchesTextFilter(filters, "code", identity.code)
      && matchesTextFilter(filters, "name", identity.name)
      && matchesChoiceFilter(filters, "area", [String(pkg.areaId ?? missing)])
      && matchesChoiceFilter(filters, "owner", [String(pkg.ownerId ?? missing)])
      && matchesNumberFilter(filters, "versions", pkg.versionCount)
      && matchesNumberFilter(filters, "nodes", pkg.usageCount)
      && matchesChoiceFilter(filters, "enabled", [pkg.isActive ? "active" : "inactive"])
      && matchesChoiceFilter(filters, "progress", [pkg.currentStatus ?? missing])
      && matchesDirectorySearch(query, identity.code, identity.name, pkg.areaName, pkg.ownerName);
  }).sort((a, b) => a.identity.code.localeCompare(b.identity.code, "zh-CN", { numeric: true }) || a.pkg.id - b.pkg.id);
  const { items: rows, page, pages, total } = directoryPage(matching, params.page, pageSize);
  const listParams = { ...filters, q: query || undefined, pageSize: String(pageSize), page: page > 1 ? String(page) : undefined };
  const headerProps = { path, params: listParams };

  return (
    <>
      <PageHeader title="软件包配置" actions={<>
        <Link href={directoryHref(`${path}/import`, listParams)} className="button button-secondary" prefetch={false}>导入历史版本</Link>
        <FormDialog label={<><Plus size={15} aria-hidden="true" />新建软件包</>} title="新建软件包" testId="new-package-trigger">
          <ActionForm action={savePackageAction} hidden={listParams} submitText="创建并配置使用范围" testId="new-package-form">
            <div className="form-grid">
              <label className="field">
                <span className="label">软件包编码</span>
                <input className="input" name="code" placeholder={"例如 " + PACKAGE_CODE_EXAMPLE} pattern={PACKAGE_CODE_PATTERN} title="5 位数字加 3 位字母" required />
              </label>
              <label className="field"><span className="label">软件包名称</span><input className="input" name="name" placeholder="例如 OTA 升级服务" required /></label>
              <label className="field"><span className="label">责任田</span><select className="select" name="areaId" required defaultValue={areas[0]?.id ?? ""}><option value="" disabled>选择责任田</option>{areas.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <label className="field"><span className="label">责任人</span><select className="select" name="ownerId" required defaultValue=""><option value="" disabled>选择责任人</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.employeeId}</option>)}</select></label>
              <label className="field span-2"><span className="label">说明</span><textarea className="textarea" name="description" /></label>
              <label className="field"><span className="label">试制超期天数</span><input className="input" type="number" name="trialOverdueDays" min={1} max={365} defaultValue={7} required /></label>
              <input type="hidden" name="isActive" value="on" />
            </div>
          </ActionForm>
        </FormDialog>
      </>} />
      <FlashMessage notice={notice} />
      <SettingsTabs isAdmin={isAdmin} canManageProjects={isAdmin || user.role === "SOFTWARE_MANAGER"} />

      <section className="card" aria-labelledby="settings-package-list">
        <div className="card-header">
          <h2 id="settings-package-list">软件包列表</h2>
          <DirectoryFilterBar {...headerProps} />
        </div>
        <div className="table-wrap" role="region" aria-label="软件包配置表格" tabIndex={0}>
          <table className="data-table">
            <thead>
              <tr>
                <ColumnFilterHeader {...headerProps} label="软件包编码" fields={[fields.code]} />
                <ColumnFilterHeader {...headerProps} label="软件包名称" fields={[fields.name]} />
                <ColumnFilterHeader {...headerProps} label="责任田 / 责任人" fields={[fields.area, fields.owner]} />
                <ColumnFilterHeader {...headerProps} label="版本记录" fields={[fields.versions]} numeric />
                <ColumnFilterHeader {...headerProps} label="使用节点" fields={[fields.nodes]} numeric />
                <ColumnFilterHeader {...headerProps} label="软件包状态" fields={[fields.enabled, fields.progress]} />
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ pkg, identity }) => {
                const detailHref = directoryHref(`${path}/${pkg.id}`, listParams);
                return (
                  <tr key={pkg.id}>
                    <th scope="row" className={styles.code}><Link href={detailHref} className="archive-link" prefetch={false}>{identity.code}</Link></th>
                    <td>{identity.name}</td>
                    <td>{pkg.areaName ?? "未归属"}<div className="small muted">{pkg.ownerName ?? "待指定"}</div></td>
                    <td className={directoryStyles.number}>{pkg.versionCount}</td>
                    <td className={directoryStyles.number}>{pkg.usageCount} 个</td>
                    <td>
                      <div className={styles.statuses}>
                        <Badge tone={pkg.isActive ? "emerald" : "slate"} dot>{pkg.isActive ? "启用" : "停用"}</Badge>
                        {pkg.currentStatus && <StatusPill status={pkg.currentStatus} />}
                      </div>
                    </td>
                    <td className="cell-actions"><Link href={detailHref} className="button button-secondary button-sm" aria-label={`配置 ${identity.code}`} prefetch={false}>配置 <ArrowUpRight size={12} aria-hidden="true" /></Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && <EmptyState title={packages.length ? "没有匹配的软件包" : "暂无可维护的软件包"} />}
        <DirectoryPagination {...headerProps} page={page} pages={pages} total={total} unit="个软件包" pageSize={pageSize} label="软件包分页" />
      </section>
    </>
  );
}
