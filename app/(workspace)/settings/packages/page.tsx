import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getLedAreaIds } from "@/lib/access";
import { filterOptions, matchesChoiceFilter, matchesNumberFilter, matchesTextFilter, readColumnFilters } from "@/lib/column-filters";
import { PACKAGE_PROGRESS_META } from "@/lib/constants";
import { getAdminPackages } from "@/lib/package-queries";
import { getPeople, getResponsibilityAreaOptions } from "@/lib/organization-queries";
import { parseFlash } from "@/lib/flash";
import { getListPageSize } from "@/lib/list-pagination";
import { packageIdentity, PACKAGE_CODE_EXAMPLE, PACKAGE_CODE_PATTERN } from "@/lib/package-identity";
import { savePackageAction } from "@/lib/actions/settings";
import { directoryColumnFields, directoryHref, directoryPage } from "@/lib/settings-directory";
import { wordSearchMatcher } from "@/lib/search-text";
import { ActionForm } from "@/components/action-form";
import { EmptyState, FlashMessage, PageHeader, StatusPill } from "@/components/ui";
import { ColumnFilterHeader } from "@/components/column-filter-header";
import { PackageNameToggle } from "@/components/package-name-toggle";
import nameVisibility from "@/components/package-name-toggle.module.css";
import { DirectoryFilterBar, DirectoryPagination } from "@/components/settings-directory";
import directoryStyles from "@/components/settings-directory.module.css";
import { SettingsSelect } from "@/components/settings-select";
import { FormDialog } from "@/components/form-dialog";
import { GuidanceDialog } from "@/components/guidance-dialog";
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
  const areas = getResponsibilityAreaOptions({ orderBy: "id" }).filter((area) => isAdmin || ledAreas.has(area.id));
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
    label: pkg.currentStatus ? PACKAGE_PROGRESS_META[pkg.currentStatus]?.label ?? pkg.currentStatus : "无在途流程",
  }));
  const { enabled, progress, ...baseFields } = directoryColumnFields.packages;
  const fields = {
    ...baseFields,
    area: { ...baseFields.area, options: filterOptions(areaOptions) },
    owner: { ...baseFields.owner, options: filterOptions(ownerOptions) },
    // Keep status filters after the counts in the directory list query.
    enabled,
    progress: { ...progress, options: filterOptions(progressOptions) },
  };

  const query = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const matchesSearch = wordSearchMatcher(query);
  const oldArea = areas.find((area) => String(area.id) === params.area);
  const legacyState = params.state ?? params.status;
  const oldState = legacyState === "active" || legacyState === "inactive" ? legacyState : undefined;
  const filters = readColumnFilters({
    ...params,
    f_area: params.f_area ?? (oldArea ? String(oldArea.id) : undefined),
    f_enabled: params.f_enabled ?? oldState,
  }, Object.values(fields));
  const pageSize = getListPageSize(params.pageSize);
  const matching = packages.map((pkg) => ({ pkg, identity: packageIdentity(pkg) })).filter(({ pkg, identity }) => {
    return matchesTextFilter(filters, fields.code.key, identity.code)
      && matchesTextFilter(filters, fields.name.key, identity.name)
      && matchesChoiceFilter(filters, fields.area.key, [String(pkg.areaId ?? missing)])
      && matchesChoiceFilter(filters, fields.owner.key, [String(pkg.ownerId ?? missing)])
      && matchesNumberFilter(filters, fields.versions.key, pkg.versionCount)
      && matchesNumberFilter(filters, fields.nodes.key, pkg.usageCount)
      && matchesChoiceFilter(filters, fields.enabled.key, [pkg.isActive ? "active" : "inactive"])
      && matchesChoiceFilter(filters, fields.progress.key, [pkg.currentStatus ?? missing])
      && matchesSearch(identity.code, identity.name, pkg.areaName, pkg.ownerName);
  }).sort((a, b) => a.identity.code.localeCompare(b.identity.code, "zh-CN", { numeric: true }) || a.pkg.id - b.pkg.id);
  const { items: rows, page, pages, total } = directoryPage(matching, params.page, pageSize);
  const listParams = { ...filters, q: query || undefined, pageSize: String(pageSize), page: page > 1 ? String(page) : undefined };
  const headerProps = { path, params: listParams };

  return (
    <>
      <PageHeader title="软件包配置" actions={<>
        <Link href={directoryHref(`${path}/import`, listParams)} className="button button-secondary" prefetch={false}>导入历史版本</Link>
        {areas.length > 0 && people.length > 0 ? (
        <FormDialog label={<><Plus size={15} aria-hidden="true" />新建软件包</>} title="新建软件包" testId="new-package-trigger">
          <ActionForm action={savePackageAction} hidden={listParams} submitText="创建并配置使用范围" testId="new-package-form">
            <div className={`form-grid ${styles.formGrid}`}>
              <label className="field">
                <span className="label">软件包编码</span>
                <input className="input" name="code" placeholder={"例如 " + PACKAGE_CODE_EXAMPLE} pattern={PACKAGE_CODE_PATTERN} title="5 位数字加 3 位字母" required />
              </label>
              <label className="field"><span className="label">软件包名称</span><input className="input" name="name" placeholder="例如 OTA 升级服务" required /></label>
              <SettingsSelect name="areaId" label="责任田" options={areas.map(({ id, name }) => ({ id, label: name }))} defaultValue={areas.length === 1 ? areas[0].id : ""} />
              <SettingsSelect name="ownerId" label="责任人" dialogSearchPlaceholder="姓名或工号"
                options={people.map((person) => ({ id: person.id, label: `${person.name} · ${person.employeeId}` }))} />
              <label className="field span-2"><span className="label">说明</span><textarea className="textarea" name="description" /></label>
              <label className="field"><span className="label">试制超期天数 <span className="required-mark" aria-hidden="true">*</span></span><input className="input" type="number" name="trialOverdueDays" min={1} max={365} defaultValue={7} required /></label>
              <input type="hidden" name="isActive" value="on" />
            </div>
          </ActionForm>
        </FormDialog>
        ) : (
          <GuidanceDialog label="新建软件包" title="新建软件包"
            items={areas.length === 0 ? [{
              title: "尚未配置责任田", detail: "新建软件包时需要指定所属责任田。",
              href: "/settings/areas", actionLabel: "前往责任田配置",
            }] : [{
              title: "没有启用的责任人账号", detail: isAdmin ? "请先启用可担任软件包责任人的账号。" : "请联系管理员启用可担任软件包责任人的账号。",
              href: isAdmin ? "/settings/users" : undefined, actionLabel: "查看人员与角色",
            }]} />
        )}
      </>} />
      <FlashMessage notice={notice} />

      <section className={`card ${nameVisibility.scope}`} aria-label="软件包列表">
        <div className={styles.tableControls}>
          <DirectoryFilterBar {...headerProps} />
          <PackageNameToggle controls="package-settings-table" />
        </div>
        <div className="table-wrap" role="region" aria-label="软件包配置表格" tabIndex={0}>
          <table className="data-table" id="package-settings-table" aria-label="软件包列表">
            <thead>
              <tr>
                <ColumnFilterHeader {...headerProps} label="软件包编码" fields={[fields.code, fields.name]} />
                <th className={nameVisibility.name} scope="col">软件包名称</th>
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
                    <td className={nameVisibility.name}><span className={`${styles.name} ${styles.nameExcerpt}`} title={identity.name}>{identity.name}</span></td>
                    <td>
                      <span className={styles.name}>{pkg.areaName ?? "未归属"}</span>
                      <span className={`small muted ${styles.name}`}>{pkg.ownerName ?? "待指定"}</span>
                    </td>
                    <td className={directoryStyles.number}>{pkg.versionCount}</td>
                    <td className={directoryStyles.number}>{pkg.usageCount} 个</td>
                    <td>
                      {pkg.currentStatus ? <StatusPill status={pkg.currentStatus} /> : <span className="muted" aria-label="无在途流程">—</span>}
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
