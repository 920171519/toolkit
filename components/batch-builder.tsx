"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import type { BatchCandidatePackage, ProjectOption } from "@/lib/workflow-queries";
import { PACKAGE_STATUS_META } from "@/lib/constants";
import { Badge } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { InfoTooltip } from "@/components/info-tooltip";
import { usePendingBatchChoices, usePendingReview } from "@/components/pending-batch-choices";
import type { CreateBatchInput } from "@/lib/workflow";
import { createBatchAction } from "@/lib/actions/workflow";
import styles from "./workflow-queue.module.css";

function statusLabel(status: string) {
  return PACKAGE_STATUS_META[status as keyof typeof PACKAGE_STATUS_META]?.label ?? status;
}

export function BatchBuilder({
  project,
  candidates,
  defaultCode,
  scopeProjectId,
  selectionKey,
  returnTo,
}: {
  project: ProjectOption;
  candidates: BatchCandidatePackage[];
  defaultCode: string;
  scopeProjectId?: number;
  selectionKey?: string;
  returnTo?: string;
}) {
  const hiddenVersions = usePendingReview(selectionKey);
  const { choices } = usePendingBatchChoices(selectionKey);
  const [selected, setSelected] = useState<Map<number, number>>(() => new Map());
  const [includeOverrides, setIncludeOverrides] = useState<Map<number, boolean>>(() => new Map());
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const rows = candidates.map((candidate) => {
    const choice = choices[candidate.packageId];
    const preselected = candidate.versions.find((entry) => entry.id === choice && entry.requestStatus === "PENDING");
    const previous = choice === null ? candidate.carryVersionId : null;
    const manualVersion = selected.get(candidate.packageId);
    const versionId = manualVersion ?? previous ?? preselected?.id ?? candidate.defaultVersionId;
    const version = candidate.versions.find((item) => item.id === versionId) ?? null;
    const included = includeOverrides.get(candidate.packageId) ?? (choice !== null || previous !== null);
    const carryPrevious = manualVersion === undefined && previous !== null;
    const changed = !carryPrevious && version?.requestStatus === "PENDING";
    return { candidate, versionId, version, included, carryPrevious, changed };
  });
  const included = rows.filter((row) => row.included);
  const changedCount = included.filter((row) => row.changed).length;
  const hiddenCount = included.filter(({ versionId, changed }) => changed && hiddenVersions.has(versionId)).length;
  const items: CreateBatchInput["items"] = included.map(({ candidate, versionId, carryPrevious }) => ({
    packageId: candidate.packageId,
    packageVersionId: versionId,
    carryPrevious: carryPrevious || undefined,
  }));
  const term = query.trim().toLocaleLowerCase();
  const matches = rows.filter(({ candidate }) => `${candidate.packageName} ${candidate.packageCode} ${candidate.ownerName ?? ""}`.toLocaleLowerCase().includes(term));
  const pageSize = 25;
  const pages = Math.max(1, Math.ceil(matches.length / pageSize));
  const visibleRows = matches.slice((page - 1) * pageSize, page * pageSize);

  return (
    <ActionForm
      action={createBatchAction}
      testId="batch-builder-form"
      submitText="保存草稿并核对"
      submitVariant="primary"
      hidden={{ projectId: project.id, scopeProjectId, items: JSON.stringify(items), returnTo }}
      disabled={changedCount === 0}
      footerNote={changedCount > 0 ? <>{items.length} 个软件包 · {changedCount} 个待测版本</> : "请至少纳入一个待测版本。"}
    >
      <section className={`${styles.section} workspace-edit-form`} aria-label="批次信息">
        <div className="form-grid">
          <label className="field"><span className="label">批次号</span><input className="input" name="code" defaultValue={defaultCode} required pattern="[Bb][0-9]{3,}" /></label>
          <label className="field"><span className="label">批次说明 <span className="muted">（选填）</span></span><input className="input" name="title" placeholder={`${project.name} ${defaultCode} 配套转测`} maxLength={80} /></label>
        </div>
      </section>

      <div className="toolbar-spread" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        <div className={styles.rowActions}>
          <h2 className={styles.tableHeading}>完整配套清单</h2>
          <InfoTooltip label="配套版本选择说明">暂缓的新版留在申请队列。有可用上轮版本时，本轮默认沿用上轮版本。</InfoTooltip>
        </div>
        <div className={styles.rowActions}>
          <label className={`input ${styles.batchSearch}`}>
            <Search size={14} aria-hidden="true" />
            <input type="search" aria-label="筛选配套软件包" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="搜索软件包" />
          </label>
          <button type="button" className="button button-secondary button-sm" onClick={() => setIncludeOverrides(new Map(rows.map(({ candidate }) => [candidate.packageId, true])))}>纳入全部软件包</button>
          <button type="button" className="button button-secondary button-sm" onClick={() => setIncludeOverrides(new Map(rows.map(({ candidate, changed }) => [candidate.packageId, changed])))}>仅纳入待测版本</button>
        </div>
      </div>

      {hiddenCount > 0 && <p className="small muted" role="status">待转测列表中被筛选隐藏的 {hiddenCount} 个版本仍纳入本轮。</p>}
      {visibleRows.length === 0 ? (
        <div className="muted-panel">没有匹配的软件包。</div>
      ) : (
        <div className="table-wrap compact-batch-table" role="region" aria-label="本轮配套软件包表格" tabIndex={0}>
          <table className="data-table">
            <thead>
              <tr>
                <th>本轮转测</th>
                <th>软件包</th>
                <th>本项目版本参考</th>
                <th>上轮转测</th>
                <th>本次转测版本</th>
                <th>相对上次</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map(({ candidate, versionId, version, included: includedInBatch, carryPrevious, changed }) => (
                <tr key={candidate.packageId} className={styles.selectionRow} data-included={includedInBatch}>
                  <td>
                    <input
                      type="checkbox"
                      checked={includedInBatch}
                      aria-label={`本轮转测 ${candidate.packageName}`}
                      onChange={(event) => {
                        const include = event.target.checked;
                        setIncludeOverrides((current) => new Map(current).set(candidate.packageId, include));
                      }}
                    />
                  </td>
                  <td>
                    <strong className={styles.packageName}>{candidate.packageName}</strong>
                    <div className={`small muted ${styles.packageName}`}>{candidate.packageCode} · {candidate.ownerName ?? "责任人待定"}</div>
                  </td>
                  <td className={styles.snapshotColumn}>
                    <div className="small muted">正式 <span className="mono">{candidate.formalVersion ?? "—"}</span></div>
                    <div className="small muted">试制 <span className="mono">{candidate.currentTrialVersions.length > 0 ? candidate.currentTrialVersions.join(" / ") : "—"}</span></div>
                  </td>
                  <td><span className="mono small">{candidate.previousTestVersion ?? "首次"}</span></td>
                  <td>
                    <select
                      className="select"
                      value={versionId}
                      disabled={!includedInBatch}
                      aria-label={`${candidate.packageName} 本次转测版本`}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        setSelected((current) => {
                          const next = new Map(current);
                          next.set(candidate.packageId, value);
                          return next;
                        });
                      }}
                    >
                      {candidate.versions.map((option) => (
                        <option value={option.id} key={option.id}>
                          {option.version} · {option.requestStatus === "PENDING" ? "本次待转测" : option.requestStatus === "VOID" ? "本项目已作废" : statusLabel(option.status)}
                        </option>
                      ))}
                    </select>
                    {includedInBatch && changed && hiddenVersions.has(versionId) && <div><Badge tone="slate">筛选隐藏但已纳入</Badge></div>}
                    {includedInBatch && (version?.requestStatus === "VOID" || version?.status === "VOID") && <div className="void-version-warning">该版本已作废。选用前请核对作废原因。</div>}
                  </td>
                  <td>
                    {!includedInBatch
                      ? <Badge tone="slate">本轮不转测</Badge>
                      : carryPrevious
                      ? <Badge tone="slate">暂缓新版，沿用上轮</Badge>
                      : !candidate.previousTestVersion
                      ? <Badge tone="slate">首次转测</Badge>
                      : version?.requestStatus === "PENDING"
                        ? <Badge tone="violet">本次有变更</Badge>
                        : version && version.version !== candidate.previousTestVersion
                          ? <Badge tone="amber">版本有调整</Badge>
                          : <Badge tone="slate">沿用上次</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && <nav className={styles.pagination} aria-label="配套软件包分页">
        <button type="button" className="button button-secondary button-sm" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>上一页</button>
        <span>第 {page} / {pages} 页</span>
        <button type="button" className="button button-secondary button-sm" disabled={page >= pages} onClick={() => setPage((current) => current + 1)}>下一页</button>
      </nav>}
    </ActionForm>
  );
}
