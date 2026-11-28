import { parseDecimalId } from "@/lib/positive-integer";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronDown, Search } from "lucide-react";
import { PackageNameToggle } from "@/components/package-name-toggle";
import { Badge, BatchStatusPill, EmptyState, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { getBatchComparison, type BatchComparisonChange, type BatchComparisonCurrent } from "@/lib/batch-comparison";
import { draftRequestListState } from "@/lib/batch-preparation";
import { formatDateTime } from "@/lib/format";
import { integrationHistoryParams, readIntegrationHistory } from "@/lib/integration-history";
import { requireWorkflowProject } from "@/lib/project-scope";
import { workflowHref } from "@/lib/workflow-links";
import { getWorkflowListState, getWorkflowSearch, workflowSearchMatcher } from "@/lib/workflow-list";
import nameVisibility from "@/components/package-name-toggle.module.css";
import styles from "./comparison.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "批次对比" };
const comparisonRegionId = "batch-comparison-table";

const comparisonLabels = {
  added: { label: "新增配套", tone: "emerald" },
  removed: { label: "移出配套", tone: "rose" },
  changed: { label: "版本变化", tone: "violet" },
  same: { label: "相同", tone: "slate" },
} satisfies Record<BatchComparisonChange, { label: string; tone: string }>;

function parseBatchId(value: unknown) {
  const id = parseDecimalId(value);
  if (id === undefined) notFound();
  return id;
}

function BatchIdentity({ batch }: { batch: Omit<BatchComparisonCurrent, "projectId" | "projectName" | "createdAt"> & { createdAt?: string } }) {
  return (
    <div className={styles.identity}>
      <p className={styles.batchName}><strong className="mono">{batch.code}</strong> {batch.title}</p>
      <div className={styles.batchMeta}>
        <BatchStatusPill status={batch.status} />
        <time dateTime={batch.sentAt ?? batch.createdAt}>{formatDateTime(batch.sentAt ?? batch.createdAt)}</time>
      </div>
    </div>
  );
}

export default async function BatchComparisonPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const batchId = parseBatchId((await params).id);
  const search = await searchParams;
  const selectedBaseId = search.base === undefined ? undefined : parseBatchId(search.base);
  const comparison = getBatchComparison(user, batchId, selectedBaseId);
  if (!comparison) notFound();

  const { current, base, candidates, rows, currentSnapshotAvailable, baseSnapshotAvailable } = comparison;
  const project = requireWorkflowProject(user, search.project, current.projectId);
  const history = readIntegrationHistory(search);
  const context = {
    ...getWorkflowListState(search),
    ...draftRequestListState(search),
    ...(history.open ? integrationHistoryParams(history) : {}),
  };
  const detailPath = `/integration/${current.id}`;
  const path = `${detailPath}/compare`;
  const backHref = workflowHref(detailPath, project?.id, context);
  const showAll = search.show === "all";
  const query = getWorkflowSearch(search.baseQuery);
  const matches = workflowSearchMatcher(query);
  const filteredCandidates = candidates.filter((candidate) => matches(candidate.code, candidate.title));
  const comparisonHref = (id: number | undefined, all: boolean) => workflowHref(path, project?.id, {
    ...context,
    base: id,
    show: all ? "all" : undefined,
  });
  const pickerFields = {
    ...context,
    project: project?.id,
    base: selectedBaseId,
    show: showAll ? "all" : undefined,
  };
  const missingSnapshots = [currentSnapshotAvailable ? null : current.code, baseSnapshotAvailable === false ? base?.code : null].filter(Boolean);
  const counts = { added: 0, removed: 0, changed: 0, same: 0 };
  for (const row of rows) counts[row.change] += 1;
  const visibleRows = showAll ? rows : rows.filter((row) => row.change !== "same");

  return (
    <>
      <PageHeader title="批次对比" description={current.projectName} actions={
        <Link href={backHref} prefetch={false} className="button button-secondary"><ArrowLeft size={14} aria-hidden="true" />返回批次详情</Link>
      } />
      <div className={styles.batchPair}>
        <section className={`card ${styles.batchCard}`} aria-labelledby="base-batch-heading">
          <h2 id="base-batch-heading">基准批次</h2>
          {base && <BatchIdentity batch={base} />}
          {candidates.length > 0 && <details key={selectedBaseId ?? "default"} className={styles.picker} open={typeof search.baseQuery === "string" || undefined}>
            <summary className="button button-secondary button-sm">{base ? "更换基准批次" : "选择基准批次"}<ChevronDown size={14} aria-hidden="true" /></summary>
            <form role="search" aria-label="搜索基准批次" action={path} method="get" className={styles.search}>
              {Object.entries(pickerFields).map(([name, value]) => value === undefined ? null :
                <input key={name} type="hidden" name={name} value={value} />)}
              <input className="input input-sm" type="search" name="baseQuery" aria-label="批次号或标题" placeholder="批次号或标题" defaultValue={query} maxLength={100} />
              <button className="button button-secondary button-sm" type="submit"><Search size={14} aria-hidden="true" />搜索</button>
            </form>
            {filteredCandidates.length ? <ul className={styles.candidates} aria-label="可对比批次">
              {filteredCandidates.map((candidate) => <li key={candidate.id}>
                <Link href={comparisonHref(candidate.id, showAll)} prefetch={false} aria-current={base?.id === candidate.id ? "true" : undefined}>
                  <BatchIdentity batch={candidate} />
                </Link>
              </li>)}
            </ul> : <p className="small muted">没有匹配的批次</p>}
          </details>}
        </section>
        <section className={`card ${styles.batchCard}`} aria-labelledby="current-batch-heading">
          <h2 id="current-batch-heading">当前批次</h2>
          <BatchIdentity batch={current} />
        </section>
      </div>
      <section className={`card ${styles.results} ${nameVisibility.scope}`} aria-labelledby="comparison-results-heading">
        <div className="card-header">
          <h2 id="comparison-results-heading">配套差异</h2>
          {rows.length > 0 && <div className={styles.resultActions}>
            {visibleRows.some((row) => row.packageName !== row.packageCode) && <PackageNameToggle controls={comparisonRegionId} />}
            <Link href={comparisonHref(selectedBaseId, !showAll)} prefetch={false} className="button button-secondary button-sm">{showAll ? "仅看差异" : "查看全部"}</Link>
          </div>}
        </div>
        {missingSnapshots.length > 0 ? <EmptyState title="缺少配套版本快照" description={`${missingSnapshots.join("、")} 无法参与配套差异对比。`} />
          : !base ? <EmptyState title={candidates.length ? "没有更早发起的批次" : "暂无可对比的批次"}
            description={candidates.length ? "可以手动选择同项目的其他已发起批次。" : "项目有其他已发起批次后即可对比。"} />
            : <>
              <ul className={styles.counts} aria-label="差异汇总">
                {Object.entries(comparisonLabels).map(([change, { label, tone }]) => <li key={change}>
                  <Badge tone={tone}>{label} {counts[change as BatchComparisonChange]}</Badge>
                </li>)}
              </ul>
              {visibleRows.length ? <div id={comparisonRegionId} className="table-wrap" role="region" aria-label="批次配套差异表格" tabIndex={0}>
                <table className={`data-table ${styles.table}`}>
                  <thead><tr><th scope="col">软件包编码</th><th scope="col">基准版本</th><th scope="col">当前版本</th><th scope="col">差异</th></tr></thead>
                  <tbody>{visibleRows.map((row) => <tr key={row.packageId}>
                    <th scope="row">
                      <span className="mono">{row.packageCode}</span>
                      {row.packageName !== row.packageCode && <span className={`${styles.packageName} ${nameVisibility.name}`}>{row.packageName}</span>}
                    </th>
                    <td className="mono">{row.baseVersion ?? "—"}</td>
                    <td className={`mono ${row.change === "changed" || row.change === "added" ? styles.changedVersion : ""}`}>{row.currentVersion ?? "—"}</td>
                    <td><Badge tone={comparisonLabels[row.change].tone}>{comparisonLabels[row.change].label}</Badge></td>
                  </tr>)}</tbody>
                </table>
              </div> : <EmptyState title="两批配套相同" />}
            </>}
      </section>
    </>
  );
}
