"use client";

import { useMemo, useState } from "react";
import { Archive } from "lucide-react";
import type { BatchCandidatePackage, ProjectOption } from "@/lib/workflow-queries";
import { PACKAGE_STATUS_META } from "@/lib/constants";
import { Badge } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { createBatchAction } from "@/lib/actions/workflow";
import type { CreateBatchInput } from "@/lib/workflow";

function statusLabel(status: string) {
  return PACKAGE_STATUS_META[status as keyof typeof PACKAGE_STATUS_META]?.label ?? status;
}

export function BatchBuilder({
  project,
  candidates,
  defaultCode,
  scopeProjectId,
  initialPendingChoices,
}: {
  project: ProjectOption;
  candidates: BatchCandidatePackage[];
  defaultCode: string;
  scopeProjectId?: number;
  initialPendingChoices?: Readonly<Record<number, number | null>>;
}) {
  const initial = useMemo(
    () => new Map(candidates.map((candidate) => {
      const requestedId = initialPendingChoices?.[candidate.packageId];
      const requestedVersion = candidate.versions.find((version) => version.id === requestedId && version.requestStatus === "PENDING");
      return [candidate.packageId, requestedVersion?.id ?? candidate.defaultVersionId];
    })),
    [candidates, initialPendingChoices],
  );
  const [selected, setSelected] = useState<Map<number, number>>(initial);
  const [excluded, setExcluded] = useState(() => new Set(
    candidates.filter((candidate) => initialPendingChoices?.[candidate.packageId] === null).map((candidate) => candidate.packageId),
  ));

  const rows = candidates.map((candidate) => {
    const deferred = excluded.has(candidate.packageId);
    const versionId = deferred ? candidate.carryVersionId : (selected.get(candidate.packageId) ?? candidate.defaultVersionId);
    const version = candidate.versions.find((option) => option.id === versionId);
    const options = deferred ? candidate.versions.filter((option) => option.id === versionId) : candidate.versions;
    return { candidate, version, options, deferred };
  });
  const changedCount = rows.filter(({ deferred, version }) => !deferred && version?.requestStatus === "PENDING").length;
  const items: CreateBatchInput["items"] = rows.flatMap(({ candidate, version, deferred }) => version ? [{
    packageId: candidate.packageId,
    packageVersionId: version.id,
    carryPrevious: deferred || undefined,
  }] : []);

  return (
    <ActionForm
      action={createBatchAction}
      testId="batch-builder-form"
      submitText="创建整套配套批次"
      submitVariant="primary"
      hidden={{ projectId: project.id, scopeProjectId, items: JSON.stringify(items) }}
      disabled={changedCount === 0}
      footerNote={<>项目 {project.name} · 本轮配套 <strong>{items.length}/{candidates.length}</strong> 个软件包，其中 <strong>{changedCount}</strong> 个待测版本。</>}
    >
      <div className="form-grid" style={{ marginBottom: 16 }}>
        <label className="field"><span className="label">批次号</span><input className="input" name="code" defaultValue={defaultCode} required pattern="[Bb][0-9]{3,}" /></label>
        <label className="field"><span className="label">批次说明</span><input className="input" name="title" placeholder={`${project.name} ${defaultCode} 整套转测`} maxLength={80} /></label>
      </div>

      <div className="toolbar-spread" style={{ marginBottom: 9 }}>
        <div><h3 style={{ fontSize: 16 }}>配套与版本选择</h3><p className="small muted" style={{ marginTop: 2 }}>默认选中所有有可用版本的软件包。取消勾选会暂缓新版本，本轮配套沿用该项目上次可用的转测版本。</p></div>
        <Badge tone={changedCount > 0 ? "amber" : "rose"}>{changedCount} 个待测版本</Badge>
      </div>

      {candidates.length === 0 ? (
        <div className="muted-panel">该项目暂未关联任何启用中的软件包。</div>
      ) : (
        <div className="table-wrap compact-batch-table">
          <table className="data-table">
            <thead>
              <tr>
                <th>本轮转测</th>
                <th>软件包</th>
                <th>当前正式版本</th>
                <th>当前试制版本</th>
                <th>上次本项目转测</th>
                <th>本次转测版本</th>
                <th>相对上次</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ candidate, version, options, deferred }) => (
                <tr key={candidate.packageId}>
                  <td>
                    <input
                      type="checkbox"
                      checked={!deferred}
                      aria-label={`本轮转测 ${candidate.packageName}`}
                      onChange={(event) => {
                        const include = event.target.checked;
                        setExcluded((current) => {
                          const next = new Set(current);
                          if (include) next.delete(candidate.packageId);
                          else next.add(candidate.packageId);
                          return next;
                        });
                      }}
                    />
                  </td>
                  <td>
                    <span style={{ fontWeight: 600 }}>{candidate.packageName}</span>
                    <div className="small muted">{candidate.packageCode} · {candidate.ownerName ?? "责任人待定"}</div>
                  </td>
                  <td><span className="mono small">{candidate.formalVersion ?? "—"}</span></td>
                  <td><span className="mono small">{candidate.currentTrialVersions.length > 0 ? candidate.currentTrialVersions.join(" / ") : "—"}</span></td>
                  <td><span className="mono small">{candidate.previousTestVersion ?? "首次"}</span></td>
                  <td style={{ minWidth: 230 }}>
                    <select
                      className="select"
                      value={version?.id ?? ""}
                      disabled={deferred}
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
                      {!version && <option value="">无可沿用版本</option>}
                      {options.map((option) => (
                        <option value={option.id} key={option.id}>
                          {option.version} · {option.requestStatus === "PENDING" ? "本次待转测" : option.requestStatus === "VOID" ? "本项目已作废" : statusLabel(option.status)}
                        </option>
                      ))}
                    </select>
                    {!deferred && version?.requestStatus === "PENDING" && <div style={{ marginTop: 4 }}><Badge tone="amber">本次新增转测</Badge></div>}
                    {(version?.requestStatus === "VOID" || version?.status === "VOID") && <div className="void-version-warning">该版本在本项目已作废，如继续选择请确认已修复问题并重新验证。</div>}
                  </td>
                  <td>
                    {deferred
                      ? <Badge tone="slate">{version ? "暂缓新版本 · 沿用上次" : "暂缓 · 本轮不纳入"}</Badge>
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

      <div className="archive-preview" style={{ marginTop: 9 }}>
        <Archive size={11} style={{ display: "inline", marginRight: 4, verticalAlign: -1 }} />
        创建批次会保存本轮配套的版本和归档地址。至少选择一个待转测版本才能创建。
      </div>
    </ActionForm>
  );
}
