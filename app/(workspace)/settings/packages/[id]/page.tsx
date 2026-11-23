import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getLedAreaIds } from "@/lib/access";
import { packageIdentity, PACKAGE_CODE_EXAMPLE } from "@/lib/package-identity";
import { directoryFilters, directoryHref } from "@/lib/settings-directory";
import { getAreaConfigs, getPackageDetail, getPeople, getProjectConfigs, parseFlash } from "@/lib/queries";
import { savePackageAction, savePackageUsagesAction } from "@/lib/actions/settings";
import { ActionForm } from "@/components/action-form";
import { InfoTooltip } from "@/components/info-tooltip";
import { FlashMessage, PageHeader, StatusPill } from "@/components/ui";
import { PackageUsagePicker } from "@/components/package-usage-picker";
import { SettingsSelect } from "@/components/settings-select";
import styles from "../package-settings.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "软件包配置详情" };

export default async function PackageSettingsDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN";
  const ledAreaIds = getLedAreaIds(user.id);
  const { id } = await params;
  const packageId = Number(id);
  if (!Number.isSafeInteger(packageId) || packageId < 1) notFound();
  const data = getPackageDetail(packageId, true);
  if (!data) notFound();
  if (!isAdmin && (data.package.areaId === null || !ledAreaIds.includes(data.package.areaId))) {
    redirect(`/dashboard?flash=${encodeURIComponent("当前角色无权访问该页面")}&tone=error`);
  }
  const search = await searchParams;
  const listParams = directoryFilters("packages", search);
  const notice = parseFlash(search.flash, search.tone === "error" ? "error" : "success");
  const allAreas = getAreaConfigs();
  const areas = isAdmin ? allAreas : allAreas.filter((area) => ledAreaIds.includes(area.id));
  const people = getPeople();
  const projects = getProjectConfigs();
  const { package: pkg, usages } = data;
  const identity = packageIdentity(pkg);
  const usedNodeIds = new Set(usages.flatMap((usage) => usage.nodes.map((node) => node.nodeId)));
  const bindingActive = data.versions.some((version) => version.status === "TRIAL" || version.status === "PENDING_FORMAL");

  return (
    <div className={styles.detail}>
      <PageHeader
        title={identity.name}
        description={<>{identity.code} · {pkg.areaName ?? "未归属责任田"} · {pkg.isActive ? "启用" : "停用"}</>}
        actions={
          <><Link href={directoryHref("/settings/packages", listParams)} className="button button-secondary" prefetch={false}><ArrowLeft size={14} aria-hidden="true" /> 返回软件包配置</Link>
            <Link href={directoryHref("/settings/packages/import", { ...listParams, package: String(pkg.id) })} className="button button-secondary" prefetch={false}>导入历史版本</Link></>
        }
      />
      <FlashMessage notice={notice} />

      <div className="two-col">
        <div className="settings-card-stack">
          <section className="card">
            <div className="card-header"><h2>责任信息</h2></div>
            <div className="card-body" style={{ paddingTop: 14 }}>
              <ActionForm action={savePackageAction} testId="package-meta-form" hidden={{ ...listParams, id: pkg.id, areaId: isAdmin ? undefined : pkg.areaId }} submitText="保存责任信息">
                <div className={`form-grid ${styles.formGrid}`}>
                  <label className="field">
                    <span className="label">软件包名称</span>
                    <input className="input" name="name" defaultValue={identity.name} required />
                  </label>
                  <div className="field">
                    <span className="settings-label-help">
                      <label className="label" htmlFor="settings-package-code">软件包编码</label>
                      <InfoTooltip label="软件包编码格式">已有编码可继续使用。新编码须为 5 位数字加 3 位字母。</InfoTooltip>
                    </span>
                    <input className="input" id="settings-package-code" name="code" defaultValue={identity.code} placeholder={"例如 " + PACKAGE_CODE_EXAMPLE} required />
                  </div>
                  <SettingsSelect name="ownerId" label="责任人" dialogSearchPlaceholder="姓名或工号"
                    options={people.map((person) => ({ id: person.id, label: `${person.name} · ${person.employeeId}` }))} defaultValue={pkg.ownerId ?? ""} />
                  {isAdmin ? <label className="field">
                    <span className="label">责任田</span>
                    <select className="select" name="areaId" defaultValue={pkg.areaId ?? ""}>
                      <option value="">暂不归属</option>
                      {areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
                    </select>
                  </label> : <div className="field">
                    <span className="settings-label-help">
                      <label className="label" htmlFor="settings-package-area">责任田</label>
                      <InfoTooltip label="责任田变更权限">由管理员调整软件包所属责任田。</InfoTooltip>
                    </span>
                    <input className="input" id="settings-package-area" value={pkg.areaName ?? "未归属"} title={pkg.areaName ?? undefined} readOnly />
                  </div>}
                  <label className="field span-2">
                    <span className="label">说明</span>
                    <textarea className="textarea" name="description" defaultValue={pkg.description} />
                  </label>
                  <label className="field">
                    <span className="label">试制超期天数 <span className="required-mark" aria-hidden="true">*</span></span>
                    <input className="input" type="number" name="trialOverdueDays" min={1} max={365} defaultValue={pkg.trialOverdueDays} required />
                  </label>
                  <div className="field span-2">
                    <label className="check-item" style={{ maxWidth: 280 }}>
                      <input type="checkbox" name="isActive" defaultChecked={pkg.isActive} aria-describedby="settings-package-disable-effect" />
                      启用软件包
                    </label>
                    <span id="settings-package-disable-effect" className="small muted">停用后禁止提交新版本，历史版本保留。</span>
                  </div>
                </div>
              </ActionForm>
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <div className="settings-label-help">
                <h2>项目节点使用范围</h2>
                <InfoTooltip label="使用范围变更说明">范围变更从下一次转测和试制生效，历史批次和绑定任务保留原范围。</InfoTooltip>
              </div>
              {bindingActive && <span className="settings-meta">{usedNodeIds.size} 个节点</span>}
            </div>
            <div className="card-body" style={{ paddingTop: 14 }}>
              {bindingActive ? (
                <div>
                  <div className="workflow-banner" data-tone="warning" style={{ marginBottom: 14 }}>
                    <ShieldAlert size={17} style={{ color: "var(--warning)", flex: "none" }} aria-hidden="true" />
                    <h3>试制和待转正版本处理完毕后可编辑使用范围</h3>
                  </div>
                  {usages.length ? <dl className="detail-list">{usages.map((usage) => (
                    <div className="detail-row" key={usage.projectId}><dt>{usage.projectName}{usage.projectStatus === "ARCHIVED" ? "（已归档）" : ""}</dt><dd>{usage.nodes.map((node) => node.nodeName).join("、")}</dd></div>
                  ))}</dl> : <p className="small muted">暂无使用节点。</p>}
                </div>
              ) : (
                <ActionForm action={savePackageUsagesAction} testId="package-usage-form" hidden={{ ...listParams, packageId: pkg.id }} submitText="保存使用范围">
                  <PackageUsagePicker projects={projects.map((project) => ({
                    id: project.id, name: project.name, code: project.code, status: project.status,
                    nodes: project.nodes.map(({ id, name, description }) => ({ id, name, description })),
                  }))} defaultNodeIds={[...usedNodeIds]} />
                </ActionForm>
              )}
            </div>
          </section>
        </div>

        <aside className="settings-card-stack">
          <section className="card">
            <div className="card-header">
              <div>
                <h2 style={{ fontSize: 16 }}>当前版本</h2>
              </div>
            </div>
            <div className="card-body" style={{ paddingTop: 13 }}>
              <dl className="detail-list">
                <div className="detail-row">
                  <dt>正式版本</dt>
                  <dd className="mono">{pkg.formalVersion ?? "—"}</dd>
                </div>
                <div className="detail-row">
                  <dt>试制版本</dt>
                  <dd className="mono">{pkg.trialVersion ?? "—"}</dd>
                </div>
                <div className="detail-row">
                  <dt>在途版本</dt>
                  <dd>
                    {pkg.currentVersion ?? "—"}
                    {pkg.currentStatus && <span style={{ marginLeft: 6 }}><StatusPill status={pkg.currentStatus} /></span>}
                  </dd>
                </div>
              </dl>
            </div>
          </section>
          <Link href={`/packages?open=${pkg.id}`} className="button button-secondary" prefetch={false}>
            在版本总览中查看
          </Link>
        </aside>
      </div>
    </div>
  );
}
