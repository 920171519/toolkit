import { parsePositiveSafeInteger } from "@/lib/positive-integer";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { correctLegacyVersionAction } from "@/lib/actions/package-settings";
import { packageIdentity } from "@/lib/package-identity";
import { getImportedPackageVersions, getLegacyVersionForCorrection } from "@/lib/settings-queries";
import { directoryFilters, directoryHref } from "@/lib/settings-directory";
import { ActionForm } from "@/components/action-form";
import { LegacyReleaseFields } from "@/components/legacy-release-fields";
import { EmptyState, PageHeader } from "@/components/ui";
import styles from "../../../package-settings.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "更正历史版本" };

export default async function LegacyVersionCorrectionPage({ params, searchParams }: {
  params: Promise<{ id: string; versionId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  if (user.role !== "ADMIN") notFound();
  const { id, versionId } = await params;
  const packageId = parsePositiveSafeInteger(id);
  const parsedVersionId = parsePositiveSafeInteger(versionId);
  if (packageId === undefined || parsedVersionId === undefined) notFound();
  const listParams = directoryFilters("packages", await searchParams);
  const back = `${directoryHref(`/settings/packages/${packageId}`, listParams)}#imported-version-history`;
  const existing = getLegacyVersionForCorrection(packageId, parsedVersionId);
  if (!existing) {
    const history = getImportedPackageVersions(packageId).find(({ id }) => id === parsedVersionId);
    if (!history) notFound();
    return (
      <>
        <PageHeader title="更正历史版本" description={history.version}
          actions={<Link href={back} className="button button-secondary" prefetch={false}>返回历史补录版本</Link>} />
        <EmptyState
          title={history.status === "VOID" ? "版本已作废" : "版本已被流程记录引用"}
          description="当前版本和相关历史证据需要保留。"
          action={<Link href={`/versions/${parsedVersionId}`} className="button button-secondary" prefetch={false}>查看历史记录</Link>} />
      </>
    );
  }
  const { code } = packageIdentity({ code: existing.packageCode, name: existing.packageName });

  return (
    <>
      <PageHeader title="更正历史版本" description={`${code} · ${existing.version} · ${existing.status === "TRIAL" ? "试制记录" : "转正记录"}`}
        actions={<Link href={back} className="button button-secondary" prefetch={false}><ArrowLeft size={14} aria-hidden="true" /> 返回历史补录版本</Link>} />
      <section className="card workspace-edit-form">
        <div className="card-body">
          <ActionForm action={correctLegacyVersionAction} testId="correct-legacy-version-form"
            hidden={{ ...listParams, packageId, versionId: parsedVersionId, expectedUpdatedAt: existing.updatedAt }}
            submitText="保存更正"
            confirmMessage={`将更新 ${code} ${existing.version} 的历史资料。更正前后的内容及原因将保留在审计记录中。`}>
            <div className={`form-grid ${styles.formGrid}`}>
              <label className="field span-2"><span className="label">版本说明/修复内容</span><textarea className="textarea" name="changeSummary" defaultValue={existing.changeSummary} required minLength={2} /></label>
              <label className="field span-2"><span className="label">归档地址</span><input className="input" name="archiveUrl" type="url" defaultValue={existing.archiveUrl} required /></label>
              <label className="field span-2"><span className="label">构建地址</span><input className="input" name="buildUrl" type="url" defaultValue={existing.buildUrl} required /></label>
              <LegacyReleaseFields existing={existing} />
              <label className="field span-2"><span className="label">更正原因 <span className="required-mark" aria-hidden="true">*</span></span><textarea className="textarea" name="reason" required minLength={5} maxLength={1000} /></label>
            </div>
          </ActionForm>
        </div>
      </section>
    </>
  );
}
