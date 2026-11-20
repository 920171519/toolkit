import type { Metadata } from "next";
import Link from "next/link";
import { DirectoryFilters, DirectoryPagination, DirectorySort } from "@/components/settings-directory";
import styles from "@/components/settings-directory.module.css";
import { SettingsTabs } from "@/components/settings-tabs";
import { Badge, EmptyState, FlashMessage, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { ROLE_META, ROLES, type Role } from "@/lib/constants";
import { getListPageSize } from "@/lib/list-pagination";
import { getAdminUsers, getResponsibilityAreaOptions, parseFlash, type AdminUser } from "@/lib/queries";
import {
  directoryHref,
  directoryOrder,
  directoryPage,
  directoryValue,
  matchesDirectorySearch,
  type DirectoryParams,
} from "@/lib/settings-directory";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "人员与角色" };

const path = "/settings/users";
const areaNames = (member: AdminUser) => member.areas.map(({ name }) => name).join("、");
const columns = {
  name: (member: AdminUser) => member.name,
  employeeId: (member: AdminUser) => member.employeeId,
  role: (member: AdminUser) => ROLE_META[member.role].label,
  area: areaNames,
  status: (member: AdminUser) => member.isActive ? 0 : 1,
  packages: (member: AdminUser) => member.ownedPackages,
};

export default async function UsersSettingsPage({ searchParams }: { searchParams: Promise<DirectoryParams> }) {
  const user = await requireRole(["ADMIN"]);
  const members = getAdminUsers();
  const areas = getResponsibilityAreaOptions();
  const search = await searchParams;
  const notice = parseFlash(search.flash, search.tone === "error" ? "error" : "success");
  const query = directoryValue(search.q);
  const roleValue = directoryValue(search.role) as Role;
  const role = ROLES.includes(roleValue) ? roleValue : "";
  const areaValue = directoryValue(search.area);
  const area = areaValue === "unassigned" || areas.some(({ id }) => String(id) === areaValue) ? areaValue : "";
  const status = search.status === "active" || search.status === "inactive" ? search.status : "";
  const filtered = members.filter((member) =>
    (!role || member.role === role) &&
    (!status || member.isActive === (status === "active")) &&
    (!area || (area === "unassigned" ? member.areas.length === 0 : member.areas.some(({ id }) => String(id) === area))) &&
    matchesDirectorySearch(query, member.name, member.employeeId, member.title, member.department, ROLE_META[member.role].label, areaNames(member)),
  );
  const { sorted, sort, order } = directoryOrder(filtered, columns, search, "name");
  const pageSize = getListPageSize(search.pageSize);
  const list = directoryPage(sorted, search.page, pageSize);
  const filters = { q: query, role, area, status, sort, order, pageSize: String(pageSize), page: String(list.page) };

  return (
    <div className={styles.stack}>
      <PageHeader eyebrow="Settings / People & roles" title="人员与角色" description="按姓名、工号、角色和责任田查找人员。" />
      <FlashMessage notice={notice} />
      <SettingsTabs isAdmin />
      <section className="card" aria-labelledby="user-list-title">
        <div className="card-header"><h2 id="user-list-title">人员列表</h2></div>
        <DirectoryFilters path={path} query={query} placeholder="姓名、工号、职位或部门" params={filters} filtered={Boolean(query || role || area || status)} pageSize={pageSize}>
          <label className="field">
            <span className="label">系统角色</span>
            <select key={role} className="select" name="role" defaultValue={role}>
              <option value="">全部角色</option>
              {ROLES.map((value) => <option key={value} value={value}>{ROLE_META[value].label}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="label">责任田</span>
            <select key={area} className="select" name="area" defaultValue={area}>
              <option value="">全部责任田</option>
              <option value="unassigned">未分配责任田</option>
              {areas.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="label">账号状态</span>
            <select key={status} className="select" name="status" defaultValue={status}>
              <option value="">全部状态</option><option value="active">启用</option><option value="inactive">停用</option>
            </select>
          </label>
        </DirectoryFilters>
        {list.items.length ? (
          <div className={styles.tableScroll} role="region" aria-label="人员列表" tabIndex={0}>
            <table className={styles.table} aria-labelledby="user-list-title">
              <thead><tr>
                <DirectorySort column="name" label="姓名" path={path} params={filters} />
                <DirectorySort column="employeeId" label="工号" path={path} params={filters} />
                <DirectorySort column="role" label="系统角色" path={path} params={filters} />
                <DirectorySort column="area" label="责任田" path={path} params={filters} />
                <DirectorySort column="status" label="账号状态" path={path} params={filters} />
                <DirectorySort column="packages" label="软件包" path={path} params={filters} />
              </tr></thead>
              <tbody>
                {list.items.map((member) => (
                  <tr key={member.id} data-testid={`user-row-${member.id}`}>
                    <td>
                      <Link href={directoryHref(`${path}/${member.id}`, filters)} className={styles.rowLink} prefetch={false}>{member.name}</Link>
                      {member.id === user.id && <> <Badge tone="sky">我</Badge></>}
                      <div className="small muted">{[member.title, member.department].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td>{member.employeeId}</td>
                    <td><Badge tone={ROLE_META[member.role].tone}>{ROLE_META[member.role].label}</Badge></td>
                    <td>{areaNames(member) || <span className="muted">未分配</span>}</td>
                    <td><Badge tone={member.isActive ? "emerald" : "slate"} dot>{member.isActive ? "启用" : "停用"}</Badge></td>
                    <td>{member.ownedPackages}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState title="没有匹配的人员" description="可以调整搜索词或筛选条件。" />}
        <DirectoryPagination path={path} params={filters} page={list.page} pages={list.pages} total={list.total} unit="人" />
      </section>
      <details className="card">
        <summary className="card-header">角色权限说明</summary>
        <dl className={`card-body ${styles.stack}`}>
          {ROLES.map((value) => (
            <div key={value}>
              <dt><Badge tone={ROLE_META[value].tone}>{ROLE_META[value].label}</Badge></dt>
              <dd className="small muted">{ROLE_META[value].description}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}
