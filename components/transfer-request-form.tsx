"use client";

import { useActionState, useId, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { GuidanceDialog } from "@/components/guidance-dialog";
import { PackageNameToggle } from "@/components/package-name-toggle";
import { submitTransferAction } from "@/lib/actions/transfer";
import type { ActionState } from "@/lib/action-state";
import { getPageWindow } from "@/lib/list-pagination";
import { LocalPagination } from "@/components/local-pagination";
import { packageIdentity } from "@/lib/package-identity";
import { invalidTransferFields, TRANSFER_CHANGE_SUMMARY_MIN_LENGTH, type TransferFormFields } from "@/lib/transfer-form-validation";
import nameVisibility from "./package-name-toggle.module.css";
import styles from "./workflow-queue.module.css";

type PackageOption = {
  id: number;
  name: string;
  code: string;
  ownerName: string | null;
};

const transferFieldGuidance: Record<keyof TransferFormFields, { title: string; detail?: string }> = {
  version: { title: "填写版本号" },
  changeSummary: { title: "填写变更说明", detail: `至少填写 ${TRANSFER_CHANGE_SUMMARY_MIN_LENGTH} 个字。` },
  archiveUrl: { title: "补齐归档链接", detail: "链接以 http:// 或 https:// 开头。" },
  buildUrl: { title: "补齐构建地址", detail: "地址以 http:// 或 https:// 开头。" },
};

export function TransferRequestForm({ packages, scopeProjectId, initialPackageId, returnTo }: {
  packages: PackageOption[];
  scopeProjectId?: number;
  initialPackageId?: number;
  returnTo?: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(submitTransferAction, {});
  const [search, setSearch] = useState("");
  const [requestedPage, setPage] = useState(1);
  const [packageId, setPackageId] = useState<number | null>(initialPackageId ?? null);
  const [version, setVersion] = useState("");
  const [changeSummary, setChangeSummary] = useState("");
  const [archiveUrl, setArchiveUrl] = useState("");
  const [buildUrl, setBuildUrl] = useState("");
  const packageLabelId = useId();
  const packageResultsId = useId();
  const summaryId = useId();
  const submitHintId = useId();

  const selected = packages.find((pkg) => pkg.id === packageId) ?? null;
  const selectedIdentity = selected ? packageIdentity(selected) : null;
  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return packages;
    return packages.filter((pkg) =>
      [pkg.name, pkg.code, pkg.ownerName ?? ""].join(" ").toLowerCase().includes(keyword),
    );
  }, [packages, search]);
  const pageSize = 12;
  const { current: page, pages, offset, end } = getPageWindow(filtered.length, pageSize, requestedPage);
  const visible = filtered.slice(offset, end);
  const conditions = invalidTransferFields({ version, changeSummary, archiveUrl, buildUrl }).map((field) => transferFieldGuidance[field]);
  if (!selected) conditions.unshift({ title: "选择软件包", detail: "按编码、名称或责任人搜索并选择软件包。" });

  return (
    <form action={formAction} data-testid="transfer-form">
      <input type="hidden" name="packageId" value={packageId ?? ""} />
      {scopeProjectId !== undefined && <input type="hidden" name="scopeProjectId" value={scopeProjectId} />}
      {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
      <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
        <div className={`field ${nameVisibility.scope}`} role="group" aria-labelledby={packageLabelId}>
          <div className="toolbar-spread">
            <span className="label" id={packageLabelId}>软件包 <span className="required-mark" aria-hidden="true">*</span></span>
            <PackageNameToggle controls={packageResultsId} />
          </div>
          {selected && selectedIdentity ? (
            <div className="package-picked" id={packageResultsId}>
              <span className={styles.packageChoiceLabel}>
                <strong className="mono">{selectedIdentity.code}</strong>
                {selectedIdentity.name !== selectedIdentity.code && <span className={`small muted ${nameVisibility.name}`}> · {selectedIdentity.name}</span>}
                {selected.ownerName && <span className="small muted"> · 责任人 {selected.ownerName}</span>}
              </span>
              <button type="button" className={`button button-ghost button-sm ${styles.packageChoiceAside}`} aria-label="更换软件包" onClick={() => setPackageId(null)}>更换</button>
            </div>
          ) : (
            <>
              <label className="input package-search-input">
                <Search size={14} aria-hidden="true" style={{ color: "var(--muted-light)", flex: "none" }} />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => { setSearch(event.target.value); setPage(1); }}
                  placeholder="编码、名称或责任人"
                  aria-label="搜索软件包"
                  data-testid="transfer-package-search"
                />
              </label>
              <div className="package-pick-list" id={packageResultsId}>
                {filtered.length === 0 ? <div className="toolbar">
                  <span className="small muted">没有匹配的软件包</span>
                  <button type="button" className="button button-secondary button-sm" onClick={() => { setSearch(""); setPage(1); }}>清除搜索</button>
                </div> : visible.map((pkg) => {
                  const { code, name } = packageIdentity(pkg);
                  return <button type="button" className="package-pick-item" key={pkg.id} onClick={() => setPackageId(pkg.id)} data-testid={`transfer-package-${pkg.id}`}>
                    <span className={styles.packageChoiceLabel}>
                      <strong className="mono">{code}</strong>
                      {name !== code && <span className={`small muted ${nameVisibility.name}`}> · {name}</span>}
                    </span>
                    <span className={`small muted ${styles.packageChoiceAside}`}>{pkg.ownerName ?? "待指定责任人"}</span>
                  </button>;
                })}
              </div>
              <LocalPagination className={styles.pagination} label="可提交软件包分页" page={page} pages={pages} onPageChange={setPage} />
            </>
          )}
        </div>
        <label className="field"><span className="label">版本号 <span className="required-mark" aria-hidden="true">*</span></span><input className="input" name="version" value={version} onChange={(event) => setVersion(event.target.value)} placeholder="2.1.0" required maxLength={40} /></label>
        <div className="field">
          <div className="label">
            <label htmlFor={summaryId}>变更说明 <span className="required-mark" aria-hidden="true">*</span></label>
            <span className="hint" id={`${summaryId}-hint`}>至少 {TRANSFER_CHANGE_SUMMARY_MIN_LENGTH} 个字</span>
          </div>
          <textarea className="textarea" id={summaryId} name="changeSummary" value={changeSummary} onChange={(event) => setChangeSummary(event.target.value)} aria-describedby={`${summaryId}-hint`} required minLength={TRANSFER_CHANGE_SUMMARY_MIN_LENGTH} />
        </div>
        <label className="field"><span className="label">包归档链接 <span className="required-mark" aria-hidden="true">*</span></span><input className="input" name="archiveUrl" type="url" value={archiveUrl} onChange={(event) => setArchiveUrl(event.target.value)} placeholder="https://packages.example.com/…" required /></label>
        <label className="field"><span className="label">构建地址 <span className="required-mark" aria-hidden="true">*</span></span><input className="input" name="buildUrl" type="url" value={buildUrl} onChange={(event) => setBuildUrl(event.target.value)} placeholder="https://ci.example.com/…" required /></label>
      </div>
      {state?.error && <div className="form-error" role="alert">{state.error}</div>}
      <div className="form-footer">
        <span id={submitHintId} className="form-note">提交后，所有使用该软件包的在行项目都会收到申请。</span>
        {conditions.length > 0 && !pending ? <GuidanceDialog label="提交申请" title="提交转测申请的条件" items={conditions} />
          : <button type="submit" className="button button-primary" aria-describedby={submitHintId} disabled={pending}>
          {pending ? "提交中…" : "提交申请"}
        </button>}
      </div>
    </form>
  );
}
