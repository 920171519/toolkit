import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Boxes, SlidersHorizontal } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { getAdminPackages, getAreaConfigs, getPeople, parseFlash } from "@/lib/queries";
import { savePackageAction } from "@/lib/actions/settings";
import { ActionForm } from "@/components/action-form";
import { Badge, FlashMessage, PageHeader, StatusPill } from "@/components/ui";
import { SettingsTabs } from "@/components/settings-tabs";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "软件包配置" };

export default async function PackagesSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireRole(["ADMIN", "SOFTWARE_MANAGER"]);
  const params = await searchParams;
  const notice = parseFlash(params.flash, params.tone === "error" ? "error" : "success");
  const packages = getAdminPackages();
  const areas = getAreaConfigs();
  const people = getPeople();

  return (
    <>
      <PageHeader
        eyebrow="Settings / Software packages"
        title="软件包配置"
        description="维护软件包名称、编码、责任人与责任田，并配置每个软件包在项目测试节点中的使用范围。使用范围决定绑定验证的覆盖清单。"
      />
      <FlashMessage notice={notice} />
      <SettingsTabs isAdmin={user.role === "ADMIN"} />

      <div className="two-col">
        <section className="card">
          <div className="card-header">
            <div>
              <h2 style={{ fontSize: 18 }}>软件包列表</h2>
              <p className="small muted" style={{ marginTop: 3 }}>
                点击配置可编辑责任信息与项目节点使用范围。
              </p>
            </div>
            <Badge tone="slate">{packages.length} 个</Badge>
          </div>
          <div className="card-body" style={{ padding: 0, marginTop: 13 }}>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>软件包</th>
                    <th>责任田 / 责任人</th>
                    <th>版本记录</th>
                    <th>使用范围</th>
                    <th>当前状态</th>
                    <th aria-label="操作" />
                  </tr>
                </thead>
                <tbody>
                  {packages.map((pkg) => (
                    <tr key={pkg.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{pkg.name}</div>
                        <div className="small muted">{pkg.code}</div>
                      </td>
                      <td>
                        <div className="small">{pkg.areaName ?? "未归属"}</div>
                        <div className="small muted">{pkg.ownerName ?? "待指定"}</div>
                      </td>
                      <td>
                        <span className="mono small">{pkg.versionCount}</span>
                      </td>
                      <td>
                        <span className="mono small">{pkg.usageCount} 节点</span>
                      </td>
                      <td>
                        {pkg.currentStatus ? (
                          <StatusPill status={pkg.currentStatus} />
                        ) : (
                          <Badge tone="emerald">正式</Badge>
                        )}
                        {!pkg.isActive && <Badge tone="slate">已停用</Badge>}
                      </td>
                      <td className="cell-actions">
                        <Link href={`/settings/packages/${pkg.id}`} className="archive-link">
                          配置 <ArrowUpRight size={12} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <aside>
          <section className="card">
            <div className="card-header">
              <div>
                <div className="eyebrow">New package</div>
                <h2 style={{ fontSize: 18, marginTop: 5 }}>新建软件包</h2>
              </div>
              <Boxes size={18} style={{ color: "var(--brand)" }} />
            </div>
            <div className="card-body" style={{ paddingTop: 14 }}>
              <ActionForm action={savePackageAction} submitText="创建并配置使用范围" testId="new-package-form">
                <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
                  <label className="field">
                    <span className="label">名称</span>
                    <input className="input" name="name" placeholder="例如 电源管理服务" required />
                  </label>
                  <div className="form-grid">
                    <label className="field">
                      <span className="label">编码</span>
                      <input className="input" name="code" placeholder="POWER" required />
                    </label>
                    <label className="field">
                      <span className="label">责任人</span>
                      <select className="select" name="ownerId" required defaultValue="">
                        <option value="" disabled>选择责任人</option>
                        {people.map((person) => (
                          <option key={person.id} value={person.id}>{person.name}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label className="field">
                    <span className="label">责任田</span>
                    <select className="select" name="areaId" defaultValue="">
                      <option value="">暂不归属</option>
                      {areas.map((area) => (
                        <option key={area.id} value={area.id}>{area.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span className="label">说明</span>
                    <textarea className="textarea" name="description" placeholder="说明软件包提供的能力。" />
                  </label>
                  <input type="hidden" name="isActive" value="on" />
                </div>
              </ActionForm>
              <p className="page-footnote">
                创建后会自动进入配置详情页，请继续勾选该软件包在各类项目测试节点中的使用范围。
              </p>
            </div>
          </section>
          <div className="muted-panel" style={{ marginTop: 14 }}>
            <SlidersHorizontal size={14} style={{ display: "inline", marginRight: 4, verticalAlign: -2 }} />
            软件包编码用于归档路径与工单识别，建议与制品库中的包名保持一致。
          </div>
        </aside>
      </div>
    </>
  );
}
