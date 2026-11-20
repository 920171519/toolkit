import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { FormDialog } from "@/components/form-dialog";
import { DirectoryFilters, DirectoryPagination, DirectorySort } from "@/components/settings-directory";
import styles from "@/components/settings-directory.module.css";
import { SettingsTabs } from "@/components/settings-tabs";
import { Badge, EmptyState, FlashMessage, PageHeader } from "@/components/ui";
import { saveAreaAction } from "@/lib/actions/settings";
import { requireUser } from "@/lib/auth";
import { getListPageSize } from "@/lib/list-pagination";
import { getAreaDirectory, getAreaMemberships, parseFlash } from "@/lib/queries";
import {
  directoryHref,
  directoryOrder,
  directoryPage,
  directoryValue,
  matchesDirectorySearch,
  type DirectoryParams,
} from "@/lib/settings-directory";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "责任田配置" };

const path = "/settings/areas";
type Area = ReturnType<typeof getAreaDirectory>[number];
const supervisors = (area: Area) => area.leaders.map(({ userName }) => userName).join("、");
const columns = {
  name: (area: Area) => area.name,
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
  const type = search.type === "integration" || search.type === "standard" ? search.type : "";
  const scope = search.scope === "mine" ? search.scope : "";
  const filtered = areas.filter((area) =>
    (!type || area.isIntegration === (type === "integration")) &&
    (!scope || myAreaIds.has(area.id)) &&
    matchesDirectorySearch(query, area.name, area.description, ...area.leaders.flatMap((leader) => [leader.userName, leader.userEmployeeId])),
  );
  const { sorted, sort, order } = directoryOrder(filtered, columns, search, "name");
  const pageSize = getListPageSize(search.pageSize);
  const list = directoryPage(sorted, search.page, pageSize);
  const filters = { q: query, type, scope, sort, order, pageSize: String(pageSize), page: String(list.page) };

  return (
    <>
      <PageHeader
        eyebrow="Settings / Responsibility areas"
        title="责任田配置"
        description="查看责任田、主管和项目分工。"
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
      <SettingsTabs
        isAdmin={isAdmin}
        canManageProjects={isAdmin || user.role === "SOFTWARE_MANAGER"}
        canManagePackages={isAdmin || areas.some((area) => area.leaders.some((leader) => leader.userId === user.id))}
      />
      <section className="card" aria-labelledby="area-list-title">
        <div className="card-header"><h2 id="area-list-title">责任田列表</h2></div>
        <div className={styles.tableScroll} role="region" aria-label="责任田列表" tabIndex={0}>
          <table className={styles.table} aria-labelledby="area-list-title">
            <thead>
              <tr>
                <th colSpan={5} className={styles.filterCell}>
                  <div className={styles.stickyContent}>
                    <DirectoryFilters path={path} query={query} placeholder="名称、说明、主管姓名或工号" params={filters} filtered={Boolean(query || type || scope)} pageSize={pageSize}>
                      <label className="field">
                        <span className="label">责任田类型</span>
                        <select key={type} className="select" name="type" defaultValue={type}>
                          <option value="">全部类型</option><option value="standard">普通责任田</option><option value="integration">集成测试责任田</option>
                        </select>
                      </label>
                      <label className="field">
                        <span className="label">分工范围</span>
                        <select key={scope} className="select" name="scope" defaultValue={scope}>
                          <option value="">全部责任田</option><option value="mine">我的责任田</option>
                        </select>
                      </label>
                    </DirectoryFilters>
                  </div>
                </th>
              </tr>
              <tr>
                <DirectorySort column="name" label="责任田" path={path} params={filters} />
                <th scope="col">类型</th>
                <DirectorySort column="leaders" label="主管" path={path} params={filters} />
                <DirectorySort column="projects" label="已设负责人的项目" path={path} params={filters} />
                <DirectorySort column="packages" label="软件包" path={path} params={filters} />
              </tr>
            </thead>
            <tbody>
              {list.items.length ? list.items.map((area) => (
                <tr key={area.id}>
                  <td>
                    <Link href={directoryHref(`${path}/${area.id}`, filters)} className={styles.rowLink} prefetch={false}>{area.name}</Link>
                    {area.description && <div className={`small muted ${styles.rowDescription}`} title={area.description}>{area.description}</div>}
                  </td>
                  <td>{area.isIntegration ? <Badge tone="teal">集成测试</Badge> : "普通"}</td>
                  <td>{supervisors(area) || <span className="muted">未指定</span>}</td>
                  <td>{area.projectCount}</td>
                  <td>{area.packageCount}</td>
                </tr>
              )) : <tr><td colSpan={5}>
                <div className={styles.stickyContent}>
                  <EmptyState title="没有匹配的责任田" description="可以调整搜索词或筛选条件。" />
                </div>
              </td></tr>}
            </tbody>
          </table>
        </div>
        <DirectoryPagination path={path} params={filters} page={list.page} pages={list.pages} total={list.total} unit="个责任田" />
      </section>
    </>
  );
}
