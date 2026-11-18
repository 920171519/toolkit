"use client";

import { useActionState, useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import { submitTransferAction } from "@/lib/actions/workflow";
import type { ActionState } from "@/lib/action-state";

type PackageOption = {
  id: number;
  name: string;
  code: string;
  ownerName: string | null;
};

export function TransferRequestForm({ packages }: { packages: PackageOption[] }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(submitTransferAction, {});
  const [search, setSearch] = useState("");
  const [packageId, setPackageId] = useState<number | null>(null);
  const [version, setVersion] = useState("");
  const [changeSummary, setChangeSummary] = useState("");
  const [archiveUrl, setArchiveUrl] = useState("");
  const [buildUrl, setBuildUrl] = useState("");

  const selected = packages.find((pkg) => pkg.id === packageId) ?? null;
  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return packages;
    return packages.filter((pkg) =>
      [pkg.name, pkg.code, pkg.ownerName ?? ""].join(" ").toLowerCase().includes(keyword),
    );
  }, [packages, search]);
  const canSubmit =
    selected !== null &&
    version.trim().length > 0 &&
    changeSummary.trim().length >= 5 &&
    /^https?:\/\//i.test(archiveUrl.trim()) &&
    /^https?:\/\//i.test(buildUrl.trim());

  return (
    <form action={formAction} data-testid="transfer-form">
      <input type="hidden" name="packageId" value={packageId ?? ""} />
      <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
        <div className="field">
          <span className="label">软件包 <span className="required-mark">*</span><span className="hint">支持搜索</span></span>
          {selected ? (
            <div className="package-picked">
              <span><strong>{selected.name}</strong> · {selected.code}{selected.ownerName ? ` · 责任人 ${selected.ownerName}` : ""}</span>
              <button type="button" className="button button-ghost button-sm" onClick={() => setPackageId(null)}>更换</button>
            </div>
          ) : (
            <>
              <label className="input package-search-input">
                <Search size={14} style={{ color: "var(--muted-light)", flex: "none" }} />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="输入软件包名称、编码或责任人搜索"
                  aria-label="搜索软件包"
                  data-testid="transfer-package-search"
                />
              </label>
              <div className="package-pick-list">
                {filtered.length === 0 ? <span className="small muted">没有匹配的软件包</span> : filtered.map((pkg) => (
                  <button type="button" className="package-pick-item" key={pkg.id} onClick={() => setPackageId(pkg.id)} data-testid={`transfer-package-${pkg.id}`}>
                    <span><strong>{pkg.name}</strong> · {pkg.code}</span>
                    <span className="small muted">{pkg.ownerName ?? "待指定责任人"}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <label className="field"><span className="label">版本号 <span className="required-mark">*</span><span className="hint">例如 2.1.0</span></span><input className="input" name="version" value={version} onChange={(event) => setVersion(event.target.value)} placeholder="填写本次提交的新版本号" required maxLength={40} /></label>
        <label className="field"><span className="label">修复问题 / 完成需求 <span className="required-mark">*</span></span><textarea className="textarea" name="changeSummary" value={changeSummary} onChange={(event) => setChangeSummary(event.target.value)} placeholder="说明本次版本解决了哪些问题、完成了哪些需求。" required minLength={5} /></label>
        <label className="field"><span className="label">包归档链接 <span className="required-mark">*</span><span className="hint">http(s) 地址</span></span><input className="input" name="archiveUrl" type="url" value={archiveUrl} onChange={(event) => setArchiveUrl(event.target.value)} placeholder="https://packages.example.com/..." required /></label>
        <label className="field"><span className="label">构建地址 <span className="required-mark">*</span><span className="hint">http(s) 地址</span></span><input className="input" name="buildUrl" type="url" value={buildUrl} onChange={(event) => setBuildUrl(event.target.value)} placeholder="https://ci.example.com/build/..." required /></label>
      </div>
      {state?.error && <div className="form-error" role="alert">{state.error}</div>}
      <div className="form-footer">
        <span className="form-note">五项信息全部填写后即可提交。</span>
        <button type="submit" className="button button-primary" disabled={!canSubmit || pending}>
          {pending ? "发送中…" : selected ? <><Check size={14} /> 提交申请</> : "提交申请"}
        </button>
      </div>
    </form>
  );
}
