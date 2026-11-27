import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { ColumnFilterHeader } from "@/components/column-filter-header";
import { FormDialog } from "@/components/form-dialog";
import { DirectoryFilterBar, DirectoryPagination } from "@/components/settings-directory";
import styles from "@/components/settings-directory.module.css";
import { EmptyState, FlashMessage, PageHeader } from "@/components/ui";
import { saveAreaAction } from "@/lib/actions/settings";
import { requireUser } from "@/lib/auth";
import {
  filterOptions,
  matchesChoiceFilter,
  matchesNumberFilter,
  matchesTextFilter,
  readColumnFilters,
} from "@/lib/column-filters";
import { getListPageSize } from "@/lib/list-pagination";
import { getAreaDirectory, getAreaMemberships } from "@/lib/organization-queries";
import { parseFlash } from "@/lib/flash";
import {
  areaDirectoryDetailParams,
  directoryColumnFields,
  directoryHref,
  directoryOrder,
  directoryPage,
  directoryValue,
  type DirectoryParams,
} from "@/lib/settings-directory";
import { wordSearchMatcher } from "@/lib/search-text";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "责任田配置" };

const path = "/settings/areas";
type Area = ReturnType<typeof getAreaDirectory>[number];
const supervisors = (area: Area) => area.leaders.map(({ userName }) => userName).join("、");
const columns = {
  name: (area: Area) => area.name,
  type: (area: Area) => Number(area.isIntegration),
  leaders: supervisors,
  projects: (area: Area) => area.projectCount,
  packages: (area: Area) => area.packageCount,
};

export default async function AreasSettingsPage({ searchParams }: { searchParams: Promise<DirectoryParams> }) {
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN";
  const search = await searchParams;
  const notice = parseFlash(search.flash, search.tone === "error" ? "error" : "success");
  const areas = getAreaDirectory();
  const myAreaIds = new Set(getAreaMemberships(user.id).map(({ areaId }) => areaId));
  const query = directoryValue(search.q);
  const matchesSearch = wordSearchMatcher(query);
  const scope = search.scope === "mine" ? search.scope : "";
  const baseFields = directoryColumnFields.areas;
  const fields = {
    ...baseFields,
    leaders: {
      ...baseFields.leaders,
      options: filterOptions([
        { value: "empty", label: "未指定" },
        ...areas.flatMap((area) => area.leaders.map(({ userId, userName, userEmployeeId }) => ({
          value: String(userId),
          label: `${userName} · ${userEmployeeId}`,
        }))),
      ]),
    },
  };
  const legacyType = fields.type.options.find(({ value }) => value === search.type)?.value;
  const selected = readColumnFilters({ ...search, f_type: search.f_type ?? legacyType }, Object.values(fields));
  const filtered = areas.filter((area) =>
    (!scope || myAreaIds.has(area.id)) &&
    matchesTextFilter(selected, fields.name.key, area.name) &&
    matchesTextFilter(selected, fields.description.key, area.description) &&
    matchesChoiceFilter(selected, fields.type.key, [area.isIntegration ? "integration" : "standard"]) &&
    matchesChoiceFilter(selected, fields.leaders.key, area.leaders.length ? area.leaders.map(({ userId }) => String(userId)) : ["empty"]) &&
    matchesNumberFilter(selected, fields.projects.key, area.projectCount) &&
    matchesNumberFilter(selected, fields.packages.key, area.packageCount) &&
    matchesSearch(area.name, area.description, ...area.leaders.flatMap((leader) => [leader.userName, leader.userEmployeeId])),
  );
  const { sorted, sort, order } = directoryOrder(filtered, columns, search, "name");
  const pageSize = getListPageSize(search.pageSize);
  const list = directoryPage(sorted, search.page, pageSize);
  const filters = { ...selected, q: query, scope, sort, order, pageSize: String(pageSize), page: String(list.page) };
  const header = { path, params: filters };
  const detailParams = areaDirectoryDetailParams(filters);

  return (
    <>
      <PageHeader
        title="责任田配置"
        actions={isAdmin && (
          <FormDialog label={<><Plus size={14} aria-hidden="true" /> 新建责任田</>} title="新建责任田" testId="new-area-trigger" cancelLabel="取消">
            <ActionForm action={saveAreaAction} hidden={filters} submitText="创建责任田" testId="new-area-form">
              <div className={styles.stack}>
                <label className="field"><span className="label">责任田名称</span><input className="input" name="name" minLength={2} maxLength={30} required /></label>
                <label className="field"><span className="label">责任田说明</span><textarea className="textarea" name="description" /></label>
              </div>
            </ActionForm>
          </FormDialog>
        )}
      />
      <FlashMessage notice={notice} />
      <section className="card">
        <div className="settings-directory-actions">
          <Link
            href={directoryHref(path, { ...filters, scope: scope ? undefined : "mine", page: undefined })}
            className="button button-secondary button-sm"
            prefetch={false}
          >
            {scope ? "显示全部责任田" : "只看我的责任田"}
          </Link>
          <DirectoryFilterBar path={path} params={filters} />
        </div>
        <div className={styles.tableScroll} role="region" aria-label="责任田列表" tabIndex={0}>
          <table className={styles.table} aria-label="责任田列表">
            <thead>
              <tr>
                <ColumnFilterHeader {...header} sortKey="name" label="责任田" fields={[fields.name, fields.description]} />
                <ColumnFilterHeader {...header} sortKey="type" label="类型" fields={[fields.type]} />
                <ColumnFilterHeader {...header} sortKey="leaders" label="主管" fields={[fields.leaders]} />
                <ColumnFilterHeader {...header} sortKey="projects" label="已设负责人的项目" fields={[fields.projects]} numeric />
                <ColumnFilterHeader {...header} sortKey="packages" label="软件包" fields={[fields.packages]} numeric />
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {list.items.length ? list.items.map((area) => (
                <tr key={area.id}>
                  <td>
                    <Link href={directoryHref(`${path}/${area.id}`, detailParams)} className={styles.rowLink} prefetch={false}>{area.name}</Link>
                    {area.description && <div className={`small muted ${styles.rowDescription}`} title={area.description}>{area.description}</div>}
                  </td>
                  <td><span className={styles.meta}>{area.isIntegration ? "集成测试" : "普通"}</span></td>
                  <td>{supervisors(area) || <span className="muted">未指定</span>}</td>
                  <td className={styles.number}>{area.projectCount}</td>
                  <td className={styles.number}>{area.packageCount}</td>
                  <td className="cell-actions"><Link href={directoryHref(`${path}/${area.id}`, detailParams)} className="button button-secondary button-sm" aria-label={`查看${area.name}`} prefetch={false}>查看详情</Link></td>
                </tr>
              )) : <tr><td colSpan={6}>
                <div className={styles.stickyContent}>
                  <EmptyState
                    title={scope && myAreaIds.size === 0 ? "你尚未分配责任田" : areas.length ? "没有匹配的责任田" : "尚未创建责任田"}
                    description={scope && myAreaIds.size === 0 ? "可切换到全部责任田查看现有分工。" : areas.length || isAdmin ? undefined : "请联系系统管理员创建责任田。"}
                  />
                </div>
              </td></tr>}
            </tbody>
          </table>
        </div>
        <DirectoryPagination path={path} params={filters} page={list.page} pages={list.pages} total={list.total} unit="个责任田" pageSize={pageSize} />
      </section>
    </>
  );
}
