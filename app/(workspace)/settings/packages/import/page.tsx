import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getLedAreaIds } from "@/lib/access";
import { packageIdentity } from "@/lib/package-identity";
import { directoryFilters, directoryHref } from "@/lib/settings-directory";
import { getPackagesOverview } from "@/lib/queries";
import { importLegacyVersionAction } from "@/lib/actions/settings";
import { ActionForm } from "@/components/action-form";
import { InfoTooltip } from "@/components/info-tooltip";
import { EmptyState, PageHeader } from "@/components/ui";
import { SettingsSelect } from "@/components/settings-select";
import styles from "../package-settings.module.css";
import { LegacyReleaseFields } from "@/components/legacy-release-fields";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "导入历史版本" };

export default async function ImportLegacyVersionPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN";
  const ledAreaIds = new Set(getLedAreaIds(user.id));
  if (!isAdmin && ledAreaIds.size === 0) {
    redirect(`/dashboard?flash=${encodeURIComponent("当前角色无权访问该页面")}&tone=error`);
  }
  const packages = getPackagesOverview(true).filter((pkg) => isAdmin || (pkg.areaId !== null && ledAreaIds.has(pkg.areaId)));
  const params = await searchParams;
  const chosen = packages.find((pkg) => String(pkg.id) === params.package);
  const listParams = directoryFilters("packages", params);
  const back = directoryHref(chosen ? `/settings/packages/${chosen.id}` : "/settings/packages", listParams);

  return (
    <>
      <PageHeader
        title="导入历史版本"
        actions={<Link href={back} className="button button-secondary" prefetch={false}><ArrowLeft size={14} aria-hidden="true" /> 返回软件包配置</Link>}
      />
      {packages.length === 0 ? (
        <EmptyState title="没有可导入历史版本的软件包" />
      ) : (
        <section className="card" style={{ maxWidth: 860 }}>
          <div className="card-body">
            <ActionForm action={importLegacyVersionAction} hidden={listParams} submitText="导入历史版本" footerNote="补录已试制或转正的版本，导入后只新增历史记录。">
              <div className={`form-grid ${styles.formGrid}`}>
                <SettingsSelect name="packageId" label="软件包" dialogSearchPlaceholder="软件包编码或名称" options={packages.map((pkg) => {
                  const { code, name } = packageIdentity(pkg);
                  return { id: pkg.id, label: `${code} · ${name}` };
                })} defaultValue={chosen?.id ?? ""} />
                <div className="field">
                  <span className="settings-label-help">
                    <label className="label" htmlFor="legacy-version-number">版本号 <span className="required-mark" aria-hidden="true">*</span></label>
                    <InfoTooltip label="历史版本号要求">同一个软件包的版本号必须唯一。</InfoTooltip>
                  </span>
                  <input className="input" id="legacy-version-number" name="version" required maxLength={40} placeholder="例如 1.6.0" />
                </div>
                <label className="field span-2"><span className="label">版本说明/修复内容 <span className="required-mark" aria-hidden="true">*</span></span><textarea className="textarea" name="changeSummary" required minLength={2} /></label>
                <label className="field span-2"><span className="label">归档地址 <span className="required-mark" aria-hidden="true">*</span></span><input className="input" name="archiveUrl" type="url" required /></label>
                <label className="field span-2"><span className="label">构建地址 <span className="required-mark" aria-hidden="true">*</span></span><input className="input" name="buildUrl" type="url" required /></label>
                <LegacyReleaseFields />
              </div>
            </ActionForm>
          </div>
        </section>
      )}
    </>
  );
}
