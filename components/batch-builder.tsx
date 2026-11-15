"use client";

import { Archive } from "lucide-react";
import type { BatchCandidatePackage, ProjectOption } from "@/lib/workflow-queries";
import { Badge } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { createBatchAction } from "@/lib/actions/workflow";

export function BatchBuilder({
  project,
  candidates,
  defaultCode,
}: {
  project: ProjectOption;
  candidates: BatchCandidatePackage[];
  defaultCode: string;
}) {
  const changedCount = candidates.filter((candidate) => candidate.requestId !== null).length;

  return (
    <ActionForm
      action={createBatchAction}
      testId="batch-builder-form"
      submitText="创建整套配套批次"
      submitVariant="primary"
      hidden={{ projectId: project.id }}
      disabled={changedCount === 0}
      footerNote={<>项目：<strong>{project.name}</strong> · 整套 <strong>{candidates.length}</strong> 个软件包，其中 <strong>{changedCount}</strong> 个待测版本。每次转测必须整套软件包一起转测。</>}
    >
      <div className="form-grid" style={{ marginBottom: 16 }}>
        <label className="field"><span className="label">批次号</span><input className="input" name="code" defaultValue={defaultCode} required pattern="[Bb][0-9]{3,}" /></label>
        <label className="field"><span className="label">批次说明</span><input className="input" name="title" placeholder={`${project.name} ${defaultCode} 整套配套转测`} maxLength={80} /></label>
      </div>

      <div className="toolbar-spread" style={{ marginBottom: 9 }}>
        <div><h3 style={{ fontSize: 16 }}>本项目整套配套快照</h3><p className="small muted" style={{ marginTop: 2 }}>系统按本项目全部在用软件包自动生成配套，不提供可选框。有新增转测申请的包使用新版本，其余使用当前正式版本。</p></div>
        <Badge tone={changedCount > 0 ? "amber" : "slate"}>{changedCount} 个待测版本</Badge>
      </div>

      {candidates.length === 0 ? (
        <div className="muted-panel">该项目暂未关联任何启用中的软件包。</div>
      ) : (
        <div className="table-wrap compact-batch-table">
          <table className="data-table">
            <thead>
              <tr>
                <th>软件包</th>
                <th>当前正式版本</th>
                <th>当前试制版本</th>
                <th>上次本项目转测</th>
                <th>本次转测版本</th>
                <th>相对上次</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((candidate) => (
                <tr key={candidate.packageId}>
                  <td>
                    <span style={{ fontWeight: 600 }}>{candidate.packageName}</span>
                    <div className="small muted">{candidate.packageCode} · {candidate.ownerName ?? "责任人待定"}</div>
                  </td>
                  <td><span className="mono small">{candidate.formalVersion ?? "—"}</span></td>
                  <td><span className="mono small">{candidate.currentTrialVersions.length > 0 ? candidate.currentTrialVersions.join(" / ") : "—"}</span></td>
                  <td><span className="mono small">{candidate.previousTestVersion ?? "首次"}</span></td>
                  <td>
                    <span className="version-badge">{candidate.version}</span>
                    {candidate.requestId
                      ? <div><Badge tone="amber">本次新增转测</Badge></div>
                      : <div className="small muted">正式版本基线</div>}
                  </td>
                  <td>
                    {!candidate.previousTestVersion
                      ? <Badge tone="slate">首次转测</Badge>
                      : candidate.changedVsPrevious
                        ? <Badge tone="violet">有变更</Badge>
                        : <Badge tone="slate">无变化</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="archive-preview" style={{ marginTop: 9 }}>
        <Archive size={11} style={{ display: "inline", marginRight: 4, verticalAlign: -1 }} />
        创建批次时会固化整套软件包当前版本、归档地址、当前试制版本和上次转测版本。
      </div>
    </ActionForm>
  );
}
