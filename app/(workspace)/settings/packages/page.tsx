import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getLedAreaIds } from "@/lib/access";
import { getAdminPackages, getAreaConfigs, getPeople, parseFlash } from "@/lib/queries";
import { savePackageAction } from "@/lib/actions/settings";
import { ActionForm } from "@/components/action-form";
import { Badge, FlashMessage, PageHeader, StatusPill } from "@/components/ui";
import { SettingsTabs } from "@/components/settings-tabs";
import { FormDialog } from "@/components/form-dialog";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "软件包配置" };

export default async function PackagesSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN";
  const ledAreaIds = getLedAreaIds(user.id);
  if (!isAdmin && ledAreaIds.length === 0) {
    redirect(`/dashboard?flash=${encodeURIComponent("当前角色无权访问该页面")}&tone=error`);
  }
  const params = await searchParams;
  const notice = parseFlash(params.flash, params.tone === "error" ? "error" : "success");
  const ledAreas = new Set(ledAreaIds);
  const areas = getAreaConfigs().filter((area) => isAdmin || ledAreas.has(area.id));
  const packages = getAdminPackages().filter((pkg) => isAdmin || (pkg.areaId !== null && ledAreas.has(pkg.areaId)));
  const people = getPeople();

  return (
    <>
      <PageHeader
        eyebrow="Settings / Software packages"
        title="软件包配置"
        description="软件包由所属责任田主管维护；软件经理不负责软件包基础配置。进入配置后可维护责任信息与项目节点使用范围。"
        actions={
          <><Link href="/settings/packages/import" className="button button-secondary">导入历史版本</Link>
          <FormDialog label={<><Plus size={14} /> 新建软件包</>} title="新建软件包" description="创建后继续配置该项目节点使用范围。" triggerClassName="button button-primary" testId="new-package-trigger">
            <ActionForm action={savePackageAction} submitText="创建并配置使用范围" testId="new-package-form">
              <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
                <label className="field"><span className="label">名称</span><input className="input" name="name" placeholder="例如 电源管理服务" required /></label>
                <div className="form-grid">
                  <label className="field"><span className="label">编码</span><input className="input" name="code" placeholder="POWER" required /></label>
                  <label className="field"><span className="label">责任人</span><select className="select" name="ownerId" required defaultValue=""><option value="" disabled>选择责任人</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
                </div>
                <label className="field"><span className="label">责任田 <span className="required-mark">*</span></span><select className="select" name="areaId" required defaultValue={areas[0]?.id ?? ""}><option value="" disabled>选择责任田</option>{areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label>
                <label className="field"><span className="label">说明</span><textarea className="textarea" name="description" placeholder="说明软件包提供的能力。" /></label>
                <label className="field"><span className="label">试制超期天数 <span className="required-mark">*</span><span className="hint">超过后提示已超期</span></span><input className="input" type="number" name="trialOverdueDays" min={1} max={365} defaultValue={7} required /></label>
                <input type="hidden" name="isActive" value="on" />
              </div>
            </ActionForm>
          </FormDialog></>
        }
      />
      <FlashMessage notice={notice} />
      <SettingsTabs isAdmin={isAdmin} canManageProjects={isAdmin || user.role === "SOFTWARE_MANAGER"} />

      <section className="card">
        <div className="card-header">
          <div><h2 style={{ fontSize: 18 }}>软件包列表</h2><p className="small muted" style={{ marginTop: 3 }}>仅显示你担任主管的责任田下的软件包。</p></div>
          <Badge tone="slate">{packages.length} 个</Badge>
        </div>
        <div className="card-body" style={{ padding: 0, marginTop: 13 }}>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>软件包</th><th>责任田 / 责任人</th><th>版本记录</th><th>使用范围</th><th>当前状态</th><th aria-label="操作" /></tr></thead>
              <tbody>
                {packages.map((pkg) => (
                  <tr key={pkg.id}>
                    <td><div style={{ fontWeight: 600 }}>{pkg.name}</div><div className="small muted">{pkg.code}</div></td>
                    <td><div className="small">{pkg.areaName ?? "未归属"}</div><div className="small muted">{pkg.ownerName ?? "待指定"}</div></td>
                    <td><span className="mono small">{pkg.versionCount}</span></td>
                    <td><span className="mono small">{pkg.usageCount} 节点</span></td>
                    <td>{pkg.currentStatus ? <StatusPill status={pkg.currentStatus} /> : <Badge tone="emerald">正式</Badge>}{!pkg.isActive && <Badge tone="slate">已停用</Badge>}</td>
                    <td className="cell-actions"><Link href={`/settings/packages/${pkg.id}`} className="archive-link">配置 <ArrowUpRight size={12} /></Link></td>
                  </tr>
                ))}
                {packages.length === 0 && <tr><td colSpan={6}><div className="muted-panel">当前责任田下暂无软件包。</div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </section>
      <div className="muted-panel" style={{ marginTop: 14 }}>软件包编码用于归档路径与工单识别，建议与制品库中的包名保持一致。</div>
    </>
  );
}
