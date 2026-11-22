import type { Metadata } from "next";
import Link from "next/link";
import { ColumnFilterHeader } from "@/components/column-filter-header";
import { DirectoryFilterBar, DirectoryPagination } from "@/components/settings-directory";
import styles from "@/components/settings-directory.module.css";
import { Avatar, Badge, EmptyState, FlashMessage, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import {
  filterOptions,
  matchesChoiceFilter,
  matchesNumberFilter,
  matchesTextFilter,
  readColumnFilters,
  type ColumnFilterField,
} from "@/lib/column-filters";
import { ROLE_META, ROLES } from "@/lib/constants";
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
  const fields = {
    name: { key: "name", label: "姓名", kind: "text" },
    title: { key: "title", label: "职位", kind: "text" },
    department: { key: "department", label: "部门", kind: "text" },
    employeeId: { key: "employeeId", label: "工号", kind: "text" },
    role: {
      key: "role", label: "系统角色", kind: "choices",
      options: ROLES.map((role) => ({ value: role, label: ROLE_META[role].label })),
    },
    area: {
      key: "area", label: "责任田", kind: "choices",
      options: filterOptions([
        { value: "empty", label: "未分配责任田" },
        ...areas.map((area) => ({ value: String(area.id), label: area.name })),
      ]),
    },
    status: {
      key: "status", label: "账号状态", kind: "choices",
      options: [{ value: "active", label: "启用" }, { value: "inactive", label: "停用" }],
    },
    packages: { key: "packages", label: "软件包数量", kind: "number" },
  } satisfies Record<string, ColumnFilterField>;
  const legacyRole = ROLES.find((role) => role === directoryValue(search.role));
  const legacyArea = search.area === "unassigned" ? "empty" : directoryValue(search.area);
  const legacyStatus = fields.status.options.find(({ value }) => value === search.status)?.value;
  const selected = readColumnFilters({
    ...search,
    f_role: search.f_role ?? legacyRole,
    f_area: search.f_area ?? fields.area.options.find(({ value }) => value === legacyArea)?.value,
    f_status: search.f_status ?? legacyStatus,
  }, Object.values(fields));
  const filtered = members.filter((member) =>
    matchesTextFilter(selected, "name", member.name) &&
    matchesTextFilter(selected, "title", member.title) &&
    matchesTextFilter(selected, "department", member.department) &&
    matchesTextFilter(selected, "employeeId", member.employeeId) &&
    matchesChoiceFilter(selected, "role", [member.role]) &&
    matchesChoiceFilter(selected, "area", member.areas.length ? member.areas.map(({ id }) => String(id)) : ["empty"]) &&
    matchesChoiceFilter(selected, "status", [member.isActive ? "active" : "inactive"]) &&
    matchesNumberFilter(selected, "packages", member.ownedPackages) &&
    matchesDirectorySearch(query, member.name, member.employeeId, member.title, member.department, ROLE_META[member.role].label, areaNames(member)),
  );
  const { sorted, sort, order } = directoryOrder(filtered, columns, search, "name");
  const pageSize = getListPageSize(search.pageSize);
  const list = directoryPage(sorted, search.page, pageSize);
  const filters = { ...selected, q: query, sort, order, pageSize: String(pageSize), page: String(list.page) };
  const header = { path, params: filters };

  return (
    <div className={styles.stack}>
      <PageHeader title="人员与角色" />
      <FlashMessage notice={notice} />
      <section className="card">
        <DirectoryFilterBar path={path} params={filters} />
        <div className={styles.tableScroll} role="region" aria-label="人员列表" tabIndex={0}>
          <table className={styles.table} aria-label="人员列表">
            <thead><tr>
              <ColumnFilterHeader {...header} sortKey="name" label="姓名" fields={[fields.name, fields.title, fields.department]} />
              <ColumnFilterHeader {...header} sortKey="employeeId" label="工号" fields={[fields.employeeId]} />
              <ColumnFilterHeader {...header} sortKey="role" label="系统角色" fields={[fields.role]} />
              <ColumnFilterHeader {...header} sortKey="area" label="责任田" fields={[fields.area]} />
              <ColumnFilterHeader {...header} sortKey="status" label="账号状态" fields={[fields.status]} />
              <ColumnFilterHeader {...header} sortKey="packages" label="软件包" fields={[fields.packages]} numeric />
              <th scope="col">操作</th>
            </tr></thead>
            <tbody>
              {list.items.length ? list.items.map((member) => (
                <tr key={member.id} data-testid={`user-row-${member.id}`}>
                  <th scope="row"><div className="toolbar"><Avatar name={member.name} /><div>
                    <Link href={directoryHref(`${path}/${member.id}`, filters)} className={styles.rowLink} prefetch={false}>{member.name}</Link>
                    {member.id === user.id && <span className="small muted">（你）</span>}
                    <div className="small muted">{[member.title, member.department].filter(Boolean).join(" · ")}</div>
                  </div></div></th>
                  <td>{member.employeeId}</td>
                  <td><span className={styles.meta}>{ROLE_META[member.role].label}</span></td>
                  <td>{areaNames(member) || <span className="muted">未分配</span>}</td>
                  <td><Badge tone={member.isActive ? "emerald" : "slate"} dot>{member.isActive ? "启用" : "停用"}</Badge></td>
                  <td className={styles.number}>{member.ownedPackages}</td>
                  <td className="cell-actions"><Link href={directoryHref(`${path}/${member.id}`, filters)} className="button button-secondary button-sm" aria-label={`管理${member.name}的账号`} prefetch={false}>管理账号</Link></td>
                </tr>
              )) : <tr><td colSpan={7}>
                <div className={styles.stickyContent}>
                  <EmptyState title="没有匹配的人员" />
                </div>
              </td></tr>}
            </tbody>
          </table>
        </div>
        <DirectoryPagination path={path} params={filters} page={list.page} pages={list.pages} total={list.total} unit="人" pageSize={pageSize} />
      </section>
      <details className="card">
        <summary className="card-header">角色权限说明</summary>
        <dl className={`card-body ${styles.stack}`}>
          {ROLES.map((value) => (
            <div key={value}>
              <dt className={styles.meta}>{ROLE_META[value].label}</dt>
              <dd className="small muted">{ROLE_META[value].description}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}
