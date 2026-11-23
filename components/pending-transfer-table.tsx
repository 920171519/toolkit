"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useRef, useState } from "react";
import { ColumnFilterHeader } from "@/components/column-filter-header";
import { RiskTrialEntryAction } from "@/components/risk-trial-entry-action";
import { ActionForm } from "@/components/action-form";
import { FormDialog } from "@/components/form-dialog";
import { InfoTooltip } from "@/components/info-tooltip";
import { WorkflowPackageName } from "@/components/workflow-package-name";
import { rememberPendingReview, usePendingBatchChoices } from "@/components/pending-batch-choices";
import { Badge, EmptyState, ExternalLink } from "@/components/ui";
import { cancelTransferAction } from "@/lib/actions/workflow";
import { columnFilterKeys, filterOptions, matchesChoiceFilter, matchesDateFilter, matchesTextFilter, type ColumnFilterField } from "@/lib/column-filters";
import { packageIdentity } from "@/lib/package-identity";
import type { RiskTrialEntry } from "@/lib/trial-risk-entry";
import { formatDate, formatDateTime } from "@/lib/format";
import { workflowHref } from "@/lib/workflow-links";
import type { PendingTransferGroup, PendingTransferItem } from "@/lib/workflow-queries";
import styles from "./workflow-queue.module.css";

const PackageDrawer = dynamic(() => import("@/components/package-drawer").then((module) => module.PackageDrawer), { ssr: false });

const fields = {
  selection: { key: "selection", label: "本轮转测", kind: "choices", options: [
    { value: "selected", label: "已勾选" },
    { value: "unselected", label: "未勾选" },
  ] },
  code: { key: "code", label: "软件包编码", kind: "text" },
  packageName: { key: "package_name", label: "软件包名称", kind: "text" },
  version: { key: "version", label: "版本号", kind: "text" },
  submitted: { key: "submitted", label: "提交时间", kind: "date" },
  archive: { key: "archive", label: "归档地址", kind: "text" },
} satisfies Record<string, ColumnFilterField>;

function submitterValue(item: PendingTransferItem) {
  return item.submittedById === null ? "unknown" : String(item.submittedById);
}

type RequestGroup = Omit<PendingTransferGroup, "items"> & {
  items: Array<PendingTransferItem & { canCancel: boolean; riskEntry?: RiskTrialEntry }>;
};

export function PendingTransferTable({ group, scopeProjectId, selection, returnState, pageSize }: {
  group: RequestGroup;
  scopeProjectId?: number;
  pageSize: number;
  selection?: { key: string; defaults: Record<number, number>; versionPackages: Record<number, number> };
  returnState: { q?: string; page?: number; pageSize?: number; returnTo?: string };
}) {
  const { projectId, projectName, projectCode, items } = group;
  const { choices, choose, reset } = usePendingBatchChoices(selection?.key);
  const [activePackage, setActivePackage] = useState<number | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const detailTrigger = useRef<HTMLAnchorElement | null>(null);
  const selectionFor = (packageId: number) => {
    const chosen = choices[packageId];
    if (chosen === null) return null;
    if (chosen !== undefined && selection?.versionPackages[chosen] === packageId) return chosen;
    return selection?.defaults[packageId];
  };
  const checkedCount = Object.keys(selection?.defaults ?? {}).filter((id) => selectionFor(Number(id)) != null).length;
  const prepareHref = workflowHref("/submissions/batch/new", projectId, { ...returnState, from: scopeProjectId ? undefined : "all" });

  const rows = items.map((item) => ({
    item,
    identity: packageIdentity({ name: item.packageName, code: item.packageCode }),
    checked: Boolean(item.canInclude) && selectionFor(item.packageId) === item.versionId,
  }));
  const matchingRows = rows.filter(({ item, identity, checked }) =>
    matchesChoiceFilter(filters, "selection", [checked ? "selected" : "unselected"]) &&
    matchesTextFilter(filters, "code", identity.code) &&
    matchesTextFilter(filters, "package_name", identity.name) &&
    matchesTextFilter(filters, "version", item.version) &&
    matchesChoiceFilter(filters, "submitter", [submitterValue(item)]) &&
    matchesDateFilter(filters, "submitted", formatDate(item.submittedAt)) &&
    matchesTextFilter(filters, "archive", item.archiveUrl),
  );
  const pages = Math.max(1, Math.ceil(matchingRows.length / pageSize));
  const currentPage = Math.min(page, pages);
  const visibleRows = matchingRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const matchingVersionIds = new Set(matchingRows.map(({ item }) => item.versionId));
  const hiddenVersions = Object.entries(selection?.versionPackages ?? {}).flatMap(([id, packageId]) => {
    const versionId = Number(id);
    return selectionFor(packageId) === versionId && !matchingVersionIds.has(versionId) ? [versionId] : [];
  });
  const checkedOnOtherPages = checkedCount - hiddenVersions.length - visibleRows.filter((row) => row.checked).length;
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
          setPage(1);
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
    <section className={`project-request-group ${styles.transferGroup}`} aria-label={`${projectName}待转测申请`}>
      <div className={styles.transferHead}>
        <div className={styles.rowActions}>
          <h3>{projectName} <span className="small muted">{projectCode} · {isFiltered ? `显示 ${matchingRows.length} / ${items.length} 个申请` : `${items.length} 个申请`}</span></h3>
          {selection && <InfoTooltip label="本轮转测选择说明">每个软件包本轮可选一个待测版本。暂缓的版本留在申请队列。</InfoTooltip>}
        </div>
        <div className={styles.cardActions}>
          {isFiltered && <button className="button button-ghost button-sm" type="button" onClick={() => { setFilters({}); setPage(1); }}>清除全部筛选</button>}
          {selection && <>
          <span className="small" role="status">
            已选 {checkedCount} 个版本
            {hiddenVersions.length > 0 && <strong>，其中 {hiddenVersions.length} 个已勾选版本被筛选隐藏，仍计入本轮。</strong>}
            {checkedOnOtherPages > 0 && <>，另有 {checkedOnOtherPages} 个在其他分页。</>}
          </span>
          {Object.keys(choices).length > 0 && <button type="button" className="button button-ghost button-sm" onClick={reset}>恢复默认选择</button>}
          <Link href={prepareHref} prefetch={false} className="button button-primary button-sm" data-testid={`open-batch-${projectId}`} onClick={() => rememberPendingReview(selection.key, hiddenVersions)}>准备转测批次 <ArrowRight size={14} aria-hidden="true" /></Link>
          </>}
        </div>
      </div>
      <div className={`table-wrap ${styles.queueTable}`} role="region" aria-label={`${projectName}待转测申请表格`} tabIndex={0}>
        <table className="data-table">
          <thead>
            <tr>
              {selection && filterHeader("本轮转测", [fields.selection])}
              {filterHeader("软件包编码", [fields.code, fields.packageName])}
              {filterHeader("版本", [fields.version])}
              {filterHeader("提交人", [submitterField])}
              {filterHeader("提交时间", [fields.submitted])}
              {filterHeader("归档地址", [fields.archive])}
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>{visibleRows.map(({ item, identity, checked }) => (
            <tr key={item.requestId}>
              {selection && <td className={styles.selectionCell}>{item.canInclude ? <input type="checkbox"
                aria-label={`本轮转测 ${item.packageName} ${item.version}`}
                checked={checked}
                onChange={(event) => choose(item.packageId, event.target.checked ? item.versionId : null)} /> : <span className="muted">—</span>}</td>}
              <th scope="row">
                <strong className="mono">{identity.code}</strong>
              </th>
              <td><Badge tone="slate">{item.version}</Badge><p className={styles.tableExcerpt} title={item.changeSummary}>{item.changeSummary}</p></td>
              <td>{item.submittedByName ?? "未知申请人"}</td>
              <td className={styles.nowrap}><time dateTime={item.submittedAt}>{formatDateTime(item.submittedAt)}</time></td>
              <td><ExternalLink href={item.archiveUrl}>归档包</ExternalLink></td>
              <td className="cell-actions"><div className={styles.cardActions}>
                <Link href={workflowHref("/packages", projectId, { open: item.packageId })} prefetch={false} className="button button-secondary button-sm"
                  aria-label={`查看 ${item.packageName} 详情`}
                  onClick={(event) => {
                    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                    event.preventDefault();
                    detailTrigger.current = event.currentTarget;
                    setActivePackage(item.packageId);
                  }}>详情</Link>
                {item.riskEntry?.stage === "PENDING" && <RiskTrialEntryAction entry={item.riskEntry} packageName={item.packageName} packageCode={item.packageCode} version={item.version} projectName={projectName} returnTo={returnState.returnTo} />}
                {item.canCancel && <FormDialog label="撤回申请" title={`撤回 ${identity.code} ${item.version}`} description="将永久删除此版本记录及其在所有使用项目中的转测申请。" triggerClassName="button button-ghost button-sm" cancelLabel="取消">
                  <WorkflowPackageName {...identity} />
                  <ActionForm action={cancelTransferAction} hidden={{ versionId: item.versionId, scopeProjectId, ...returnState }}
                    submitText="确认撤回" submitVariant="outline-danger" submitClassName="button-sm" />
                </FormDialog>}
              </div></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {visibleRows.length === 0 && <EmptyState title="没有匹配的待转测申请" />}
      {pages > 1 && <nav className={`toolbar ${styles.rowActions}`} aria-label={`${projectName}申请列表分页`}>
        <button className="button button-secondary button-sm" type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>上一页</button>
        <span className="small muted">第 {currentPage} / {pages} 页</span>
        <button className="button button-secondary button-sm" type="button" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>下一页</button>
      </nav>}
      {activePackage !== null && <PackageDrawer key={activePackage} packageId={activePackage} projectId={projectId} people={[]} readOnly canSubmitTransfer={false} onClose={() => {
        setActivePackage(null);
        requestAnimationFrame(() => detailTrigger.current?.focus());
      }} />}
    </section>
  );
}
