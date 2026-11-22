import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getLedAreaIds } from "@/lib/access";
import { getAdminPackages, getAreaConfigs, getPeople, parseFlash } from "@/lib/queries";
import { getListPageSize, LIST_PAGE_SIZES } from "@/lib/list-pagination";
import { packageIdentity, PACKAGE_CODE_EXAMPLE, PACKAGE_CODE_PATTERN } from "@/lib/package-identity";
import { savePackageAction } from "@/lib/actions/settings";
import { ActionForm } from "@/components/action-form";
import { Badge, EmptyState, FlashMessage, PageHeader, StatusPill } from "@/components/ui";
import directoryStyles from "@/components/settings-directory.module.css";
import { SettingsTabs } from "@/components/settings-tabs";
import { FormDialog } from "@/components/form-dialog";
import styles from "./package-settings.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "软件包配置" };

function normalized(value: string) {
  return value.normalize("NFKC").toLowerCase();
}

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
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const area = areas.find((item) => String(item.id) === params.area);
  const state = params.state === "active" || params.state === "inactive" ? params.state : "";
  const pageSize = getListPageSize(params.pageSize);
  const terms = normalized(query).split(/\s+/).filter(Boolean);
  const matching = packages.map((pkg) => ({ pkg, identity: packageIdentity(pkg) })).filter(({ pkg, identity }) => {
    if (area && pkg.areaId !== area.id) return false;
    if (state && pkg.isActive !== (state === "active")) return false;
    const text = normalized([identity.code, identity.name, pkg.areaName, pkg.ownerName].join(" "));
    return terms.every((term) => text.includes(term));
  }).sort((a, b) => a.identity.code.localeCompare(b.identity.code, "zh-CN", { numeric: true }) || a.pkg.id - b.pkg.id);
  const pageCount = Math.max(1, Math.ceil(matching.length / pageSize));
  const requested = typeof params.page === "string" ? Number(params.page) : 1;
  const page = Number.isSafeInteger(requested) ? Math.max(1, Math.min(requested, pageCount)) : 1;
  const start = (page - 1) * pageSize;
  const rows = matching.slice(start, start + pageSize);

  function listHref(pageNumber: number, clear = false) {
    const search = new URLSearchParams({ pageSize: String(pageSize) });
    if (!clear && query) search.set("q", query);
    if (!clear && area) search.set("area", String(area.id));
    if (!clear && state) search.set("state", state);
    if (pageNumber > 1) search.set("page", String(pageNumber));
    return `/settings/packages?${search.toString()}`;
  }

  return (
    <>
      <PageHeader title="软件包配置" actions={<>
        <Link href="/settings/packages/import" className="button button-secondary" prefetch={false}>导入历史版本</Link>
        <FormDialog label={<><Plus size={15} aria-hidden="true" />新建软件包</>} title="新建软件包" testId="new-package-trigger">
          <ActionForm action={savePackageAction} submitText="创建并配置使用范围" testId="new-package-form">
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
        <form action="/settings/packages" method="get" role="search" aria-label="查找软件包" className={styles.toolbar}>
          <label className="field">
            <span className="label">搜索软件包</span>
            <input className="input" type="search" name="q" defaultValue={query} maxLength={100} placeholder="编码、名称、责任田或责任人" />
          </label>
          {areas.length > 1 && <div className="field"><label className="label" htmlFor="package-settings-area">责任田</label><select id="package-settings-area" className="select" name="area" defaultValue={area?.id ?? ""}><option value="">全部责任田</option>{areas.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>}
          <div className="field"><label className="label" htmlFor="package-settings-state">启停状态</label><select id="package-settings-state" className="select" name="state" defaultValue={state}><option value="">全部</option><option value="active">启用</option><option value="inactive">停用</option></select></div>
          <div className="field"><label className="label" htmlFor="package-settings-page-size">每页条数</label><select id="package-settings-page-size" className="select" name="pageSize" defaultValue={pageSize}>{LIST_PAGE_SIZES.map((size) => <option key={size}>{size}</option>)}</select></div>
          <button className="button button-secondary" type="submit">查询</button>
          {(query || area || state) && <Link href={listHref(1, true)} prefetch={false} className="button button-ghost">清除筛选</Link>}
        </form>
        <div className="card-header">
          <h2 id="settings-package-list">软件包列表</h2>
          <span className={directoryStyles.meta} role="status">{matching.length ? `${start + 1}–${start + rows.length} / ${matching.length} 个软件包` : "0 个软件包"}</span>
        </div>
        {rows.length ? (
          <div className="table-wrap" role="region" aria-label="软件包配置表格" tabIndex={0}>
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">软件包编码</th>
                  <th scope="col">软件包名称</th>
                  <th scope="col">责任田 / 责任人</th>
                  <th scope="col" className={directoryStyles.number}>版本记录</th>
                  <th scope="col" className={directoryStyles.number}>使用节点</th>
                  <th scope="col">启停状态</th>
                  <th scope="col">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ pkg, identity }) => (
                  <tr key={pkg.id}>
                    <th scope="row" className={styles.code}><Link href={`/settings/packages/${pkg.id}`} className="archive-link" prefetch={false}>{identity.code}</Link></th>
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
                    <td className="cell-actions"><Link href={`/settings/packages/${pkg.id}`} className="button button-secondary button-sm" aria-label={`配置 ${identity.code}`} prefetch={false}>配置 <ArrowUpRight size={12} aria-hidden="true" /></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState title={packages.length ? "没有匹配的软件包" : "暂无可维护的软件包"} />}
        {pageCount > 1 && (
          <nav className={styles.pagination} aria-label="软件包分页">
            {page > 1 && <Link href={listHref(page - 1)} prefetch={false} className="button button-secondary button-sm">上一页</Link>}
            <span>第 {page} / {pageCount} 页</span>
            {page < pageCount && <Link href={listHref(page + 1)} prefetch={false} className="button button-secondary button-sm">下一页</Link>}
          </nav>
        )}
      </section>
    </>
  );
}
