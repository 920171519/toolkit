"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { ActionForm } from "@/components/action-form";
import { BatchBuilder } from "@/components/batch-builder";
import { ColumnFilterHeader } from "@/components/column-filter-header";
import { FormDialog } from "@/components/form-dialog";
import { PackageDrawer } from "@/components/package-drawer";
import { RiskTrialEntryAction } from "@/components/risk-trial-entry-action";
import { EmptyState, ExternalLink } from "@/components/ui";
import { cancelTransferAction } from "@/lib/actions/workflow";
import { columnFilterKeys, filterOptions, matchesChoiceFilter, matchesDateFilter, matchesTextFilter, type ColumnFilterField } from "@/lib/column-filters";
import { formatDate, formatDateTime } from "@/lib/format";
import { workflowHref } from "@/lib/workflow-links";
import { packageIdentity } from "@/lib/package-identity";
import type { RiskTrialEntry } from "@/lib/trial-risk-entry";
import type { BatchCandidatePackage, PendingTransferGroup, PendingTransferItem, ProjectOption } from "@/lib/workflow-queries";
import styles from "./pending-transfer-table.module.css";

type RequestRow = PendingTransferItem & { canCancel: boolean; riskEntry?: RiskTrialEntry };
type RequestGroup = Omit<PendingTransferGroup, "items"> & { items: RequestRow[] };

const fields = {
  selection: { key: "selection", label: "本轮转测", kind: "choices", options: [
    { value: "selected", label: "已勾选" },
    { value: "unselected", label: "未勾选" },
  ] },
  code: { key: "code", label: "软件包编码", kind: "text" },
  packageName: { key: "package_name", label: "软件包名称", kind: "text" },
  version: { key: "version", label: "版本号", kind: "text" },
  submitted: { key: "submitted", label: "提交时间", kind: "date" },
  archive: { key: "archive", label: "固定地址", kind: "text" },
} satisfies Record<string, ColumnFilterField>;

function submitterValue(item: PendingTransferItem) {
  return item.submittedById === null ? "unknown" : String(item.submittedById);
}

function isPendingVersion(candidate: BatchCandidatePackage | undefined, versionId: number) {
  return candidate?.versions.some((version) => version.id === versionId && version.requestStatus === "PENDING") ?? false;
}

export function PendingTransferTable({ group, batch, scopeProjectId }: {
  group: RequestGroup;
  batch?: { candidates: BatchCandidatePackage[]; code: string };
  scopeProjectId?: number;
}) {
  const { projectId, projectName, projectCode, items } = group;
  const project: ProjectOption = { id: projectId, name: projectName, code: projectCode, status: "ACTIVE" };
  const [choices, setChoices] = useState<Record<number, number | null>>({});
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [detailPackageId, setDetailPackageId] = useState<number | null>(null);
  const detailTrigger = useRef<HTMLAnchorElement | null>(null);
  const closeDetail = useCallback(() => {
    setDetailPackageId(null);
    requestAnimationFrame(() => detailTrigger.current?.focus());
  }, []);

  const byPackage = new Map(batch?.candidates.map((candidate) => [candidate.packageId, candidate]));
  const currentChoices = Object.fromEntries(Object.entries(choices).filter(([packageId, versionId]) =>
    versionId === null || isPendingVersion(byPackage.get(Number(packageId)), versionId),
  ));
  const rows = items.map((item) => {
    const candidate = byPackage.get(item.packageId);
    const selectable = isPendingVersion(candidate, item.versionId);
    const choice = currentChoices[item.packageId];
    const selection = choice === undefined ? candidate?.defaultVersionId : choice;
    return { item, identity: packageIdentity({ name: item.packageName, code: item.packageCode }), selectable, checked: selectable && selection === item.versionId };
  });
  const checkedCount = rows.filter((row) => row.checked).length;
  const visibleRows = rows.filter(({ item, identity, checked }) =>
    matchesChoiceFilter(filters, "selection", [checked ? "selected" : "unselected"]) &&
    matchesTextFilter(filters, "code", identity.code) &&
    matchesTextFilter(filters, "package_name", identity.name) &&
    matchesTextFilter(filters, "version", item.version) &&
    matchesChoiceFilter(filters, "submitter", [submitterValue(item)]) &&
    matchesDateFilter(filters, "submitted", formatDate(item.submittedAt)) &&
    matchesTextFilter(filters, "archive", item.archiveUrl),
  );
  const visibleVersionIds = new Set(visibleRows.map(({ item }) => item.versionId));
  const filteredOutPendingVersionIds = rows.filter(({ item }) => !visibleVersionIds.has(item.versionId)).map(({ item }) => item.versionId);
  const hiddenCheckedCount = checkedCount - visibleRows.filter((row) => row.checked).length;
  const isFiltered = Object.keys(filters).length > 0;
  const submitterField: ColumnFilterField = {
    key: "submitter",
    label: "提交人",
    kind: "choices",
    options: filterOptions(items.map((item) => ({ value: submitterValue(item), label: item.submittedByName ?? "未知申请人" }))),
  };

  function filterHeader(label: string, column: ColumnFilterField[]) {
    return (
      <ColumnFilterHeader
        label={label}
        path="/submissions"
        params={filters}
        fields={column}
        onFilterChange={(next) => {
          setFilters((current) => {
            const updated = { ...current };
            for (const key of column.flatMap(columnFilterKeys)) delete updated[key];
            return { ...updated, ...next };
          });
        }}
      />
    );
  }

  return (
    <section className="project-request-group" aria-label={`${projectName}待转测申请`}>
      <div className={styles.heading}>
        <div>
          <h3>{projectName} <span className="small muted">{projectCode} · {isFiltered ? `显示 ${visibleRows.length} / ${items.length} 个申请` : `${items.length} 个申请`}</span></h3>
          {batch && (
            <p className="small muted" role="status">
              已选 {checkedCount} 个版本。
              {hiddenCheckedCount > 0 && <span className={styles.hiddenSelection}>其中 {hiddenCheckedCount} 个已勾选版本被筛选隐藏，仍计入本轮。</span>}
              {hiddenCheckedCount === 0 && "同一软件包本轮可选一个版本，未勾选的申请保留到下轮。"}
            </p>
          )}
        </div>
        <div className={styles.headingActions}>
          {isFiltered && <button className="button button-ghost button-sm" type="button" onClick={() => setFilters({})}>清除全部筛选</button>}
          {batch && (
            <FormDialog label="整套发起转测" title={`${projectName} · 发起整套转测`}
              triggerClassName="button button-secondary button-sm" testId={`open-batch-${projectId}`} wide>
              {batch.candidates.length > 0 ? (
                <BatchBuilder project={project} candidates={batch.candidates} defaultCode={batch.code} scopeProjectId={scopeProjectId} initialPendingChoices={currentChoices}
                  filteredOutPendingVersionIds={filteredOutPendingVersionIds} />
              ) : <div className="muted-panel">本项目当前没有可组织转测的软件包版本。</div>}
            </FormDialog>
          )}
        </div>
      </div>
      <div className="table-wrap" role="region" aria-label={`${projectName}待转测申请表格`} tabIndex={0}>
        <table className="data-table">
          <thead>
            <tr>
              {batch && filterHeader("本轮转测", [fields.selection])}
              {filterHeader("软件包编码", [fields.code, fields.packageName])}
              {filterHeader("版本", [fields.version])}
              {filterHeader("提交人", [submitterField])}
              {filterHeader("提交时间", [fields.submitted])}
              {filterHeader("固定地址", [fields.archive])}
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(({ item, identity, selectable, checked }) => (
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
                    {item.riskEntry?.stage === "PENDING" && (
                      <RiskTrialEntryAction entry={item.riskEntry} packageName={item.packageName} version={item.version} projectName={projectName} />
                    )}
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
      {visibleRows.length === 0 && <EmptyState title="没有匹配的待转测申请" description="可调整表头筛选或清除筛选后查看申请。" />}
      {detailPackageId !== null && <PackageDrawer packageId={detailPackageId} projectId={projectId} people={[]} readOnly onClose={closeDetail} />}
    </section>
  );
}
