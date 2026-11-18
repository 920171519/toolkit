import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { canManagePackageArea } from "@/lib/access";
import { getPackagesOverview } from "@/lib/queries";
import { importLegacyVersionAction } from "@/lib/actions/settings";
import { ActionForm } from "@/components/action-form";
import { EmptyState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "导入历史版本" };

export default async function ImportLegacyVersionPage() {
  const user = await requireUser();
  const packages = getPackagesOverview(true).filter((pkg) => canManagePackageArea(user, pkg.areaId));

  return (
    <>
      <PageHeader
        eyebrow="Legacy import"
        title="导入历史版本"
        description="用于系统启用前已经转正或已发布试制的软件包版本。只录入版本基本信息和电子流证据；导入版本不进入后续转测/绑定流程，后续新版本仍从转测申请开始跟踪。"
        actions={<Link href="/settings/packages" className="button button-secondary"><ArrowLeft size={14} />返回软件包配置</Link>}
      />
      {packages.length === 0 ? (
        <EmptyState title="没有可维护的软件包" description="仅系统管理员和责任田主管可以导入自己责任田下的软件包版本。" />
      ) : (
        <section className="card" style={{ maxWidth: 860 }}>
          <div className="card-header"><div><h2 style={{ fontSize: 18 }}>版本基本信息</h2><p className="small muted" style={{ marginTop: 3 }}>版本号在软件包内唯一；已转正版本至少填写转正电子流和转正日期，试制中版本至少填写试制电子流和试制发布日期。</p></div></div>
          <div className="card-body">
            <ActionForm action={importLegacyVersionAction} submitText="导入历史版本">
              <div className="form-grid">
                <label className="field"><span className="label">软件包 <span className="required-mark">*</span></span><select className="select" name="packageId" required defaultValue=""><option value="" disabled>请选择软件包</option>{packages.map((pkg) => <option key={pkg.id} value={pkg.id}>{pkg.name} · {pkg.code}</option>)}</select></label>
                <label className="field"><span className="label">版本号 <span className="required-mark">*</span></span><input className="input" name="version" required maxLength={40} placeholder="例如 1.6.0" /></label>
                <label className="field span-2"><span className="label">版本说明/修复内容 <span className="required-mark">*</span></span><textarea className="textarea" name="changeSummary" required minLength={2} placeholder="简要说明该历史版本包含的需求或修复内容。" /></label>
                <label className="field span-2"><span className="label">归档地址 <span className="required-mark">*</span></span><input className="input" name="archiveUrl" type="url" required placeholder="https://packages.example.com/releases/..." /></label>
                <label className="field span-2"><span className="label">构建地址 <span className="required-mark">*</span></span><input className="input" name="buildUrl" type="url" required placeholder="https://ci.example.com/build/..." /></label>
                <label className="field"><span className="label">历史状态 <span className="required-mark">*</span></span><select className="select" name="status" defaultValue="FORMAL"><option value="FORMAL">已转正</option><option value="TRIAL">试制中</option></select></label>
                <label className="field"><span className="label">试制电子流</span><input className="input" name="trialFormNo" placeholder="已转正版本如无试制记录可留空" /></label>
                <label className="field"><span className="label">试制发布日期</span><input className="input" name="trialReleasedAt" type="date" /></label>
                <label className="field"><span className="label">转正电子流</span><input className="input" name="formFlowNo" placeholder="已转正版本必填" /></label>
                <label className="field"><span className="label">转正日期</span><input className="input" name="formalReleasedAt" type="date" /></label>
              </div>
              <p className="form-note" style={{ marginTop: 10 }}>导入后可在软件包详情、软件版本总览和版本全链路中查看；不会创建项目转测申请或绑定任务。</p>
            </ActionForm>
          </div>
        </section>
      )}
    </>
  );
}
