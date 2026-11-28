"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { ColumnFilterHeader } from "@/components/column-filter-header";
import { ActionForm } from "@/components/action-form";
import { FormDialog } from "@/components/form-dialog";
import { GuidanceDialog } from "@/components/guidance-dialog";
import { InfoTooltip } from "@/components/info-tooltip";
import { WorkflowPackageName } from "@/components/workflow-package-name";
import { rememberPendingReview, usePendingBatchChoices } from "@/components/pending-batch-choices";
import { Badge, EmptyState, ExternalLink } from "@/components/ui";
import { cancelTransferAction } from "@/lib/actions/transfer";
import { columnFilterKeys, filterOptions, matchesChoiceFilter, matchesDateFilter, matchesTextFilter, type ColumnFilterField } from "@/lib/column-filters";
import { getPageWindow } from "@/lib/list-pagination";
import { LocalPagination } from "@/components/local-pagination";
import { packageIdentity } from "@/lib/package-identity";
import { formatDate, formatDateTime } from "@/lib/format";
import { workflowHref } from "@/lib/workflow-links";
import type { PendingTransferGroup, PendingTransferItem } from "@/lib/pending-transfer-queries";
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

function submitterValue(item: TransferRow) {
  return item.submittedById === null ? "unknown" : String(item.submittedById);
}

type TransferRow = Omit<PendingTransferItem, "draftBatchId" | "draftBatchProjectId" | "draftBatchCode"> & {
  draftReserved: boolean;
  draftBatch: { id: number; projectId: number; code: string | null } | null;
  canCancel: boolean;
  riskAction: ReactNode;
};

type RequestGroup = Omit<PendingTransferGroup, "items"> & { items: TransferRow[] };

export function PendingTransferTable({ group, scopeProjectId, hasProjectWorkflowScope, selection, returnState, pageSize }: {
  group: RequestGroup;
  scopeProjectId?: number;
  hasProjectWorkflowScope: boolean;
  pageSize: number;
  selection?: { key: string; defaults: Record<number, number>; versionPackages: Record<number, number> };
  returnState: { q?: string; page?: number; pageSize?: number; request?: number; returnTo?: string };
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
  const { current: currentPage, pages, offset, end } = getPageWindow(matchingRows.length, pageSize, page);
  const visibleRows = matchingRows.slice(offset, end);
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
          {isFiltered && matchingRows.length > 0 && <button className="button button-ghost button-sm" type="button" onClick={() => { setFilters({}); setPage(1); }}>清除全部筛选</button>}
          {selection && <>
          <span className="small" role="status">
            已选 {checkedCount} 个版本
            {hiddenVersions.length > 0 && <strong>，其中 {hiddenVersions.length} 个已勾选版本被筛选隐藏，仍计入本轮。</strong>}
            {checkedOnOtherPages > 0 && <>，另有 {checkedOnOtherPages} 个在其他分页。</>}
          </span>
          {Object.keys(choices).length > 0 && <button type="button" className="button button-ghost button-sm" onClick={reset}>恢复默认选择</button>}
          {Object.keys(selection.defaults).length > 0 ? <Link href={prepareHref} prefetch={false} className="button button-primary button-sm" data-testid={`open-batch-${projectId}`} onClick={() => rememberPendingReview(selection.key, hiddenVersions)}>准备转测批次 <ArrowRight size={14} aria-hidden="true" /></Link>
            : <GuidanceDialog label="准备转测批次" title="准备转测批次的条件" fallbackHref={prepareHref}
              items={[{ title: "目前没有可纳入的待转测版本", detail: "先处理已占用的草稿，或提交可在本项目验证的新版本。",
                href: items.some((item) => item.draftReserved) ? workflowHref("/submissions", projectId, { view: "drafts", returnTo: returnState.returnTo }) : workflowHref("/submissions/transfer", projectId, { returnTo: returnState.returnTo }),
                actionLabel: items.some((item) => item.draftReserved) ? "查看待发起批次" : "查看转测提交条件" }]} />}
          </>}
        </div>
      </div>
      <div className={`table-wrap ${styles.queueTable}`} role="region" aria-label={`${projectName}待转测申请表格`} tabIndex={0}>
        <table className="data-table">
          <colgroup>
            <col className={styles.transferCompactColumn} span={selection ? 2 : 1} />
            <col />
            <col className={styles.transferCompactColumn} span={4} />
          </colgroup>
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
                aria-label={`本轮转测 ${identity.code} ${item.version}`}
                checked={checked}
                onChange={(event) => choose(item.packageId, event.target.checked ? item.versionId : null)} /> : item.draftBatch
                  ? <Link href={workflowHref(`/integration/${item.draftBatch.id}`, scopeProjectId === undefined ? undefined : item.draftBatch.projectId, { ...returnState, fromRequests: "1" })} prefetch={false} className="archive-link">{item.draftBatch.code} 草稿占用</Link>
                  : <span className="small muted">{item.draftReserved ? "草稿占用" : item.packageActive ? "不在项目使用范围" : "软件包已停用"}</span>}</td>}
              <th scope="row"><strong className="mono">{identity.code}</strong></th>
              <td><Badge tone="slate">{item.version}</Badge><p className={styles.tableExcerpt} title={item.changeSummary}>{item.changeSummary}</p></td>
              <td>{item.submittedByName ?? "未知申请人"}</td>
              <td className={styles.nowrap}><time dateTime={item.submittedAt}>{formatDateTime(item.submittedAt)}</time></td>
              <td><ExternalLink href={item.archiveUrl}>归档包</ExternalLink></td>
              <td className="cell-actions"><div className={styles.cardActions}>
                <Link href={workflowHref("/packages", projectId, { open: item.packageId })} prefetch={false} className="button button-secondary button-sm"
                  aria-label={`查看 ${identity.code} 详情`}
                  onClick={(event) => {
                    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                    event.preventDefault();
                    detailTrigger.current = event.currentTarget;
                    setActivePackage(item.packageId);
                  }}>详情</Link>
                {item.riskAction}
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
      {visibleRows.length === 0 && <EmptyState title="没有匹配的待转测申请"
        action={isFiltered && <button className="button button-secondary button-sm" type="button"
          onClick={() => { setFilters({}); setPage(1); }}>清除全部筛选</button>} />}
      <LocalPagination className={`toolbar ${styles.rowActions}`} label={`${projectName}申请列表分页`} page={currentPage} pages={pages} onPageChange={setPage} countClassName="small muted" />
      {activePackage !== null && <PackageDrawer key={activePackage} packageId={activePackage} projectId={projectId} hasProjectWorkflowScope={hasProjectWorkflowScope}
        people={[]} readOnly returnFocus={detailTrigger} onClose={() => setActivePackage(null)} />}
    </section>
  );
}
