"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { ActionForm } from "@/components/action-form";
import { BatchBuilder } from "@/components/batch-builder";
import { FormDialog } from "@/components/form-dialog";
import { PackageDrawer } from "@/components/package-drawer";
import { ExternalLink } from "@/components/ui";
import { cancelTransferAction } from "@/lib/actions/workflow";
import { formatDateTime } from "@/lib/format";
import { workflowHref } from "@/lib/workflow-links";
import { packageIdentity } from "@/lib/package-identity";
import type { BatchCandidatePackage, PendingTransferGroup, PendingTransferItem, ProjectOption } from "@/lib/workflow-queries";
import styles from "./pending-transfer-table.module.css";

type RequestRow = PendingTransferItem & { canCancel: boolean };
type RequestGroup = Omit<PendingTransferGroup, "items"> & { items: RequestRow[] };

export function PendingTransferTable({ group, batch, scopeProjectId }: {
  group: RequestGroup;
  batch?: { candidates: BatchCandidatePackage[]; code: string };
  scopeProjectId?: number;
}) {
  const { projectId, projectName, projectCode, items } = group;
  const project: ProjectOption = { id: projectId, name: projectName, code: projectCode, status: "ACTIVE" };
  const [choices, setChoices] = useState<Record<number, number | null>>({});
  const [detailPackageId, setDetailPackageId] = useState<number | null>(null);
  const detailTrigger = useRef<HTMLAnchorElement | null>(null);
  const closeDetail = useCallback(() => {
    setDetailPackageId(null);
    requestAnimationFrame(() => detailTrigger.current?.focus());
  }, []);

  const byPackage = new Map(batch?.candidates.map((candidate) => [candidate.packageId, candidate]));
  const rows = items.map((item) => {
    const candidate = byPackage.get(item.packageId);
    const selectable = candidate?.versions.some((version) => version.id === item.versionId && version.requestStatus === "PENDING") ?? false;
    const choice = choices[item.packageId];
    const selection = choice === undefined ? candidate?.defaultVersionId : choice;
    return { item, identity: packageIdentity({ name: item.packageName, code: item.packageCode }), selectable, checked: selectable && selection === item.versionId };
  });
  const checkedCount = rows.filter((row) => row.checked).length;

  return (
    <section className="project-request-group" aria-label={`${projectName}待转测申请`}>
      <div className={styles.heading}>
        <div>
          <h3>{projectName} <span className="small muted">{projectCode} · {items.length} 个申请</span></h3>
          {batch && <p className="small muted">已选 {checkedCount} 个版本。同一软件包本轮可选一个版本，未勾选的申请保留到下轮。</p>}
        </div>
        {batch && (
          <FormDialog label="整套发起转测" title={`${projectName} · 整套配套转测`}
            triggerClassName="button button-secondary button-sm" testId={`open-batch-${projectId}`} wide>
            {batch.candidates.length > 0 ? (
              <BatchBuilder project={project} candidates={batch.candidates} defaultCode={batch.code} scopeProjectId={scopeProjectId} initialPendingChoices={choices} />
            ) : <div className="muted-panel">本项目当前没有可组织转测的软件包版本。</div>}
          </FormDialog>
        )}
      </div>
      <div className="table-wrap" role="region" aria-label={`${projectName}待转测申请表格`} tabIndex={0}>
        <table className="data-table">
          <thead>
            <tr>
              {batch && <th scope="col">本轮转测</th>}
              <th scope="col">软件包编码</th>
              <th scope="col">版本</th>
              <th scope="col">提交人</th>
              <th scope="col">提交时间</th>
              <th scope="col">固定地址</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ item, identity, selectable, checked }) => (
              <tr key={item.requestId}>
                {batch && <td><input type="checkbox" checked={checked} disabled={!selectable}
                  aria-label={`本轮转测 ${item.packageName} ${item.version}`}
                  onChange={(event) => {
                    const selection = event.target.checked ? item.versionId : null;
                    setChoices((current) => ({ ...current, [item.packageId]: selection }));
                  }} /></td>}
                <td>
                  <strong className="mono">{identity.code}</strong>
                  {identity.name !== identity.code && <div className="small muted">{identity.name}</div>}
                  {item.ownerName && <div className="small muted">责任人 {item.ownerName}</div>}
                </td>
                <td><span className="version-badge">{item.version}</span><div className={styles.changeSummary}>{item.changeSummary}</div></td>
                <td>{item.submittedByName ?? "未知申请人"}</td>
                <td><time dateTime={item.submittedAt}>{formatDateTime(item.submittedAt)}</time></td>
                <td><ExternalLink href={item.archiveUrl}><span className={styles.address} title={item.archiveUrl}>{item.archiveUrl}</span></ExternalLink></td>
                <td className="cell-actions">
                  <div className={styles.actions}>
                    <Link href={workflowHref("/packages", projectId, { open: item.packageId })} prefetch={false} className="button button-secondary button-sm"
                      aria-label={`查看 ${item.packageName} 详情`}
                      onClick={(event) => {
                        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                        event.preventDefault();
                        detailTrigger.current = event.currentTarget;
                        setDetailPackageId(item.packageId);
                      }}>详情</Link>
                    {item.canCancel && (
                      <ActionForm action={cancelTransferAction} hidden={{ versionId: item.versionId, scopeProjectId }} submitText="撤回申请" submitVariant="outline-danger"
                        submitClassName="button-sm" confirmMessage={`撤回将同时撤销 ${item.packageName} ${item.version} 在所有项目的转测申请，确认继续？`} className="inline-action-form" />
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {detailPackageId !== null && <PackageDrawer packageId={detailPackageId} projectId={projectId} people={[]} readOnly onClose={closeDetail} />}
    </section>
  );
}
