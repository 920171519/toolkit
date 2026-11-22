import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Boxes, CheckSquare2, ShieldAlert } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getLedAreaIds } from "@/lib/access";
import { packageIdentity, PACKAGE_CODE_EXAMPLE } from "@/lib/package-identity";
import { redirect } from "next/navigation";
import { getAreaConfigs, getPackageDetail, getPeople, getProjectConfigs, parseFlash } from "@/lib/queries";
import { savePackageAction, savePackageUsagesAction } from "@/lib/actions/settings";
import { directoryFilters, directoryHref } from "@/lib/settings-directory";
import { ActionForm } from "@/components/action-form";
import { Badge, FlashMessage, PageHeader, StatusPill } from "@/components/ui";
import styles from "@/components/settings-directory.module.css";
import { SettingsTabs } from "@/components/settings-tabs";

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
  if (!Number.isInteger(packageId)) notFound();
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
  const bindingActive = pkg.currentStatus === "TRIAL" || pkg.currentStatus === "PENDING_FORMAL";

  return (
    <>
      <PageHeader
        title={identity.name}
        description={identity.code + " · 维护责任信息与项目节点使用范围。"}
        actions={
          <Link href={directoryHref("/settings/packages", listParams)} className="button button-secondary" prefetch={false}>
            <ArrowLeft size={14} /> 返回软件包配置
          </Link>
        }
      />
      <FlashMessage notice={notice} />
      <SettingsTabs isAdmin={isAdmin} canManageProjects={isAdmin || user.role === "SOFTWARE_MANAGER"} />

      <div className="two-col">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <section className="card">
            <div className="card-header">
              <div>
                <h2 style={{ fontSize: 18 }}>责任信息</h2>
                <p className="small muted" style={{ marginTop: 3 }}>
                  新增或修改编码时使用 5 位数字和 3 位字母。
                </p>
              </div>
              <Boxes size={17} style={{ color: "var(--brand)" }} />
            </div>
            <div className="card-body" style={{ paddingTop: 14 }}>
              <ActionForm action={savePackageAction} testId="package-meta-form" hidden={{ ...listParams, id: pkg.id }} submitText="保存责任信息">
                <div className="form-grid">
                  <label className="field">
                    <span className="label">软件包编码</span>
                    <input className="input" name="code" defaultValue={identity.code} placeholder={"例如 " + PACKAGE_CODE_EXAMPLE} required />
                  </label>
                  <label className="field">
                    <span className="label">软件包名称</span>
                    <input className="input" name="name" defaultValue={identity.name} required />
                  </label>
                  <label className="field">
                    <span className="label">责任人</span>
                    <select className="select" name="ownerId" defaultValue={pkg.ownerId ?? ""} required>
                      <option value="" disabled>选择责任人</option>
                      {people.map((person) => (
                        <option key={person.id} value={person.id}>{person.name} · {person.employeeId}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span className="label">责任田</span>
                    <select className="select" name="areaId" defaultValue={pkg.areaId ?? ""}>
                      <option value="">暂不归属</option>
                      {areas.map((area) => (
                        <option key={area.id} value={area.id}>{area.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field span-2">
                    <span className="label">说明</span>
                    <textarea className="textarea" name="description" defaultValue={pkg.description} />
                  </label>
                  <label className="field">
                    <span className="label">试制超期天数 <span className="required-mark">*</span></span>
                    <input className="input" type="number" name="trialOverdueDays" min={1} max={365} defaultValue={pkg.trialOverdueDays} required />
                  </label>
                  <label className="check-item span-2" style={{ maxWidth: 280 }}>
                    <input type="checkbox" name="isActive" defaultChecked={pkg.isActive} />
                    <span>
                      启用此软件包
                      <span className="small muted" style={{ display: "block" }}>
                        停用后不可提交新版本，但历史版本仍会保留。
                      </span>
                    </span>
                  </label>
                </div>
              </ActionForm>
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <div>
                <h2 style={{ fontSize: 18 }}>项目节点使用范围</h2>
                <p className="small muted" style={{ marginTop: 3 }}>
                  勾选代表该项目测试节点会加载此软件包。发布试制时，系统会为全部勾选节点生成绑定验证任务。
                </p>
              </div>
              <span className={styles.meta}>{usedNodeIds.size} 个节点</span>
            </div>
            <div className="card-body" style={{ paddingTop: 14 }}>
              {bindingActive ? (
                <div>
                  <div className="workflow-banner" data-tone="warning" style={{ marginBottom: 14 }}>
                    <ShieldAlert size={17} style={{ color: "var(--warning)", flex: "none" }} />
                    <div>
                      <h3>当前版本正在绑定验证，使用范围已冻结</h3>
                      <p>
                        为避免覆盖证据丢失，在全部节点验证完成前不能调整使用范围。完成转正后可以修改。
                      </p>
                    </div>
                  </div>
                  <div className="check-grid">
                    {projects.flatMap((project) =>
                      project.nodes.map((node) => (
                        <label className="check-item" key={node.id}>
                          <input type="checkbox" checked={usedNodeIds.has(node.id)} readOnly disabled />
                          <span>
                            {project.name} / {node.name}
                            <span className="small muted" style={{ display: "block" }}>{node.description}</span>
                          </span>
                        </label>
                      )),
                    )}
                  </div>
                </div>
              ) : (
                <ActionForm action={savePackageUsagesAction} testId="package-usage-form" hidden={{ ...listParams, packageId: pkg.id }} submitText="保存使用范围">
                  <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                    {projects.map((project) => (
                      <div key={project.id}>
                        <div className="toolbar" style={{ gap: 8, marginBottom: 7 }}>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>{project.name}</span>
                          <span className="chip">{project.code}</span>
                          {project.status === "ARCHIVED" && <Badge tone="slate">存档项目</Badge>}
                          <span className="small muted">
                            {project.status === "ARCHIVED" ? "存档项目不参与新的绑定验证" : `${project.nodes.length} 个测试节点`}
                          </span>
                        </div>
                        <div className="check-grid">
                          {project.nodes.map((node) => (
                            <label className="check-item" key={node.id}>
                              <input
                                type="checkbox"
                                name="nodeIds"
                                value={node.id}
                                defaultChecked={usedNodeIds.has(node.id)}
                              />
                              <span>
                                {node.name}
                                <span className="small muted" style={{ display: "block" }}>
                                  {node.description || "测试节点"}
                                </span>
                              </span>
                            </label>
                          ))}
                          {project.nodes.length === 0 && (
                            <span className="small muted">该项目尚未配置测试节点。</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </ActionForm>
              )}
            </div>
          </section>
        </div>

        <aside style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
              <p className="page-footnote">
                {bindingActive
                  ? "绑定验证完成后会自动进入待转正。"
                  : "在途版本流程完成后，才能提交下一个版本。"}
              </p>
            </div>
          </section>
          <div className="muted-panel">
            <CheckSquare2 size={14} style={{ display: "inline", marginRight: 4, verticalAlign: -2 }} />
            建议在发起转测前完成使用范围配置，避免试制发布后才发现覆盖节点不完整。
          </div>
          <Link href={`/packages?open=${pkg.id}`} className="button button-secondary">
            在版本总览中查看
          </Link>
        </aside>
      </div>
    </>
  );
}
