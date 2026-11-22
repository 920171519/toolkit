import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { canAccessProjectPage, canManageProjectWorkflowForProject } from "@/lib/access";
import { CONCLUSION_META, PACKAGE_STATUS_META, PROJECT_STATUS_META, TRANSFER_REQUEST_STATUS_META, type PackageStatus } from "@/lib/constants";
import { formatDateTime } from "@/lib/format";
import { getWorkflowProjectOptions } from "@/lib/project-scope";
import { PROJECT_STAGE_META } from "@/lib/project-stage";
import { getPackageOverviewRows, parseFlash } from "@/lib/queries";
import { safeOverviewReturnPath } from "@/lib/return-to";
import { workflowHref } from "@/lib/workflow-links";
import {
  getPendingFormalVersions,
  getPendingTransferGroups,
  getProjectVersionRows,
  getTrialReadyVersions,
  getTrialVersions,
} from "@/lib/workflow-queries";
import { Badge, BatchStatusPill, EmptyState, FlashMessage, PageHeader, SectionHeading } from "@/components/ui";
import { getProjectBatchCounts, getProjectCatalogEntries, getRecentProjectBatches } from "../project-data";
import styles from "../projects.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "项目概览" };

const previewLength = 5;

function projectVersionStatus(status: string) {
  return TRANSFER_REQUEST_STATUS_META[status as keyof typeof TRANSFER_REQUEST_STATUS_META]
    ?? PACKAGE_STATUS_META[status as PackageStatus]
    ?? { label: status, tone: "slate" };
}

export default async function ProjectOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const projectId = Number(id);
  if (!Number.isSafeInteger(projectId) || projectId < 1) notFound();
  const [project] = getProjectCatalogEntries([projectId]);
  if (!project) notFound();
  const search = await searchParams;
  const notice = parseFlash(search.flash, search.tone === "error" ? "error" : "success");
  const returnTo = safeOverviewReturnPath(search.returnTo);
  const projectStatus = PROJECT_STATUS_META[project.status];
  const stage = PROJECT_STAGE_META[project.stage];
  const projectHeader = (
    <>
      <PageHeader title={project.name} />
      <FlashMessage notice={notice} />
      <dl className={styles.projectIdentity}>
        <div><dt>项目代号</dt><dd className="mono">{project.code}</dd></div>
        <div><dt>产品阶段</dt><dd>{stage.label}</dd></div>
        <div><dt>流程状态</dt><dd><Badge tone={projectStatus.tone} dot>{projectStatus.label}</Badge></dd></div>
        <div><dt>PM</dt><dd>{project.pms.map((person) => person.name).join("、") || "未分配"}</dd></div>
        <div><dt>软件经理</dt><dd>{project.softwareManagers.map((person) => person.name).join("、") || "未分配"}</dd></div>
      </dl>
      {project.description && (
        <details className={styles.projectDescription}>
          <summary>项目说明</summary>
          <p>{project.description}</p>
        </details>
      )}
    </>
  );
  const canViewWorkflow = canAccessProjectPage(user, projectId)
    && getWorkflowProjectOptions(user, true).some((option) => option.id === projectId);
  if (!canViewWorkflow) {
    return (
      <div className={styles.projectOverview}>
        {projectHeader}
        <section className={`card ${styles.accessNotice}`} aria-label="项目访问范围">
          <h2>项目流程需要分配权限</h2>
          <p>请联系项目管理员开通流程权限。</p>
          <Link href={returnTo ?? "/overview"} className="button button-secondary" prefetch={false}>返回项目总览</Link>
        </section>
      </div>
    );
  }

  const currentProject = project.status !== "ARCHIVED";
  const canPrepare = currentProject && canManageProjectWorkflowForProject(user, projectId);
  const scopedHref = (path: string, values?: Record<string, string | number | undefined>) => workflowHref(path, projectId, { ...values, returnTo });

  const recentBatches = getRecentProjectBatches(projectId, previewLength, canPrepare);
  const packageRows = getPackageOverviewRows(projectId, true);
  const projectVersions = getProjectVersionRows(projectId, previewLength);
  const pending = currentProject ? getPendingTransferGroups([projectId])[0]?.items.length ?? 0 : 0;
  const batches = currentProject ? getProjectBatchCounts(projectId, canPrepare) : { draft: 0, inTest: 0 };
  const ready = canPrepare ? getTrialReadyVersions([projectId]).length : 0;
  const bindings = currentProject ? getTrialVersions([projectId]) : [];
  const formal = currentProject ? getPendingFormalVersions([projectId]) : [];
  const lateBindings = bindings.filter((version) => version.isOverdue).length;
  const lateFormal = formal.filter((version) => version.isOverdue).length;
  const showBindingQueue = !canPrepare || lateBindings > 0 || (ready === 0 && bindings.length > 0);
  const bindingDetail = showBindingQueue
    ? ready > 0 ? `${ready} 个版本待发试制` : undefined
    : bindings.length > 0 ? `${bindings.length} 个版本绑定中` : undefined;
  const stages = [
    {
      label: "转测",
      metric: { count: pending, label: "待安排" },
      detail: batches.draft > 0 ? `${batches.draft} 个批次待发起` : undefined,
      href: "/submissions",
      view: pending === 0 && batches.draft > 0 ? "drafts" : undefined,
    },
    { label: "集成测试", metric: { count: batches.inTest, label: "在测" }, href: "/integration" },
    {
      label: "试制与绑定",
      metric: showBindingQueue ? { count: bindings.length, label: "绑定中" } : { count: ready, label: "待发试制" },
      detail: canPrepare ? bindingDetail : undefined,
      href: "/trial",
      view: showBindingQueue ? "binding" : undefined,
      overdue: lateBindings,
    },
    { label: "待转正", metric: { count: formal.length }, href: "/formal", overdue: lateFormal },
  ];

  return (
    <div className={styles.projectOverview}>
      {projectHeader}

      {currentProject && (
        <section className={styles.metricGrid} aria-label="当前流程">
          {stages.map(({ label, metric, detail, href, view, overdue }) => (
            <Link
              key={href}
              id={href === "/trial" ? "trials" : undefined}
              href={scopedHref(href, { view })}
              className={styles.metricCard}
              data-urgent={Boolean(overdue) || undefined}
              prefetch={false}
            >
              <div className={styles.metricCardHead}>{label}<ArrowRight size={14} aria-hidden="true" /></div>
              <div className={styles.metricValue}><strong>{metric.count}</strong>{metric.label && <span>{metric.label}</span>}</div>
              {(detail || Boolean(overdue)) && (
                <div className={styles.cardDetail}>
                  {detail && <span>{detail}</span>}
                  {Boolean(overdue) && <Badge tone="rose">{overdue} 个已超期</Badge>}
                </div>
              )}
            </Link>
          ))}
        </section>
      )}

      <div className={styles.projectColumns}>
        <section id="batches" className={`card ${styles.panel}`} aria-label="最近批次">
          <div className={styles.panelHead}>
            <SectionHeading title="最近批次" actions={(
              <Link href={scopedHref("/integration", { view: currentProject ? undefined : "history" })} className="button button-ghost button-sm" prefetch={false}>全部批次 <ArrowRight size={13} aria-hidden="true" /></Link>
            )} />
          </div>
          {recentBatches.length === 0 ? <div className={styles.emptyPanel}>暂无集成测试批次</div> : (
            <ul className={styles.activityList}>
              {recentBatches.map((batch) => {
                const conclusion = batch.conclusion ? CONCLUSION_META[batch.conclusion] : undefined;
                return (
                  <li key={batch.id} className={styles.activityItem}>
                    <div className={styles.activityMain}>
                      <div>
                        <Link href={scopedHref(`/integration/${batch.id}`)} className="mono" prefetch={false}>{batch.code}</Link>
                      </div>
                      <p>{batch.title}</p>
                    </div>
                    <div className={styles.activityMeta}>
                      {(!conclusion || batch.status !== "COMPLETED") && <BatchStatusPill status={batch.status} />}
                      {conclusion && <Badge tone={conclusion.tone}>{conclusion.label}</Badge>}
                      <span>{formatDateTime(batch.activityAt)}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section id="versions" className={`card ${styles.panel}`} aria-label="版本流程记录">
          <div className={styles.panelHead}>
            <SectionHeading title="版本流程记录" actions={(
              <Link href={scopedHref("/versions")} className="button button-ghost button-sm" prefetch={false}>版本全链路 <ArrowRight size={13} aria-hidden="true" /></Link>
            )} />
          </div>
          {projectVersions.length === 0 ? <div className={styles.emptyPanel}>暂无项目版本记录</div> : (
            <ul className={styles.activityList}>
              {projectVersions.map((version) => {
                const status = projectVersionStatus(version.status);
                return (
                  <li key={version.requestId} className={styles.activityItem}>
                    <div className={styles.activityMain}>
                      <div>
                        <Link href={scopedHref(`/versions/${version.versionId}`)} prefetch={false}>{version.packageName} <span className="mono">{version.version}</span></Link>
                      </div>
                      {version.batchCode && <p>集成批次 <span className="mono">{version.batchCode}</span></p>}
                    </div>
                    <div className={styles.activityMeta}>
                      <Badge tone={status.tone}>{status.label}</Badge>
                      {version.isOverdue > 0 && <Badge tone="rose">已超期</Badge>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <section id="packages" className={`card ${styles.panel}`} aria-label="软件包与全局使用范围">
        <div className={styles.panelHead}>
          <SectionHeading title="软件包" actions={packageRows.length > 0 && (
            <Link href={scopedHref("/packages")} className="button button-ghost button-sm" prefetch={false}>
              全部 {packageRows.length} 个软件包 <ArrowRight size={13} aria-hidden="true" />
            </Link>
          )} />
        </div>
        {packageRows.length === 0 ? (
          <EmptyState title="暂无软件包" />
        ) : (
          <div className="table-wrap" tabIndex={0} role="region" aria-label="项目软件包表，可横向滚动">
            <table className={`data-table ${styles.packageTable}`}>
              <thead><tr><th scope="col">软件包</th><th scope="col">正式版</th><th scope="col">试制版</th><th scope="col">本项目节点</th><th scope="col">全部项目使用范围</th></tr></thead>
              <tbody>
                {packageRows.slice(0, previewLength).map((pkg) => {
                  const localUsage = pkg.usages.find((usage) => usage.projectId === projectId);
                  return (
                    <tr key={pkg.id}>
                      <td>
                        <Link href={scopedHref("/packages", { open: pkg.id })} className={styles.tableLink} prefetch={false}>{pkg.name}</Link>
                        <div className={styles.secondaryText}>{pkg.code} · {pkg.areaName ?? "未归属"}</div>
                      </td>
                      <td className="mono">{pkg.formalVersion ?? "—"}</td>
                      <td className="mono">{pkg.trialVersions.join(" / ") || "—"}</td>
                      <td>{localUsage?.nodeNames.join("、") || "—"}</td>
                      <td className={styles.packageScope}>
                        {pkg.usages.map((usage) => (
                          <span key={usage.projectId}>{usage.projectName} <small>{usage.nodeNames.join("、")}{usage.projectStatus === "ARCHIVED" && "（已归档）"}</small></span>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
