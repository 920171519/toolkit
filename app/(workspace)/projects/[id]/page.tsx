import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { canAccessProjectPage, canManageProjectWorkflowForProject, getBatchEvidenceReadScope, getReadableLinkedBatchEvidence } from "@/lib/access";
import { CONCLUSION_META, PACKAGE_STATUS_META, PROJECT_STATUS_META, TRANSFER_REQUEST_STATUS_META, type PackageStatus } from "@/lib/constants";
import { formatDateTime } from "@/lib/format";
import { packageIdentity } from "@/lib/package-identity";
import identityStyles from "@/components/package-identity.module.css";
import { getProjectCatalogEntries } from "@/lib/project-queries";
import { getWorkflowProjectOptions } from "@/lib/project-scope";
import { PROJECT_STAGE_META } from "@/lib/project-stage";
import { getPackageOverviewRows, parseFlash } from "@/lib/queries";
import { safeOverviewReturnPath } from "@/lib/return-to";
import { getTrialReadyVersions } from "@/lib/trial-eligibility";
import { workflowHref } from "@/lib/workflow-links";
import {
  getPendingTransferGroups,
  getProjectBatchCounts,
  getProjectTrialAndFormalCounts,
  getProjectVersionRows,
  getRecentProjectBatches,
} from "@/lib/workflow-queries";
import { Badge, BatchStatusPill, EmptyState, FlashMessage, PageHeader, SectionHeading } from "@/components/ui";
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
  const [project] = getProjectCatalogEntries(projectId);
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
          <p>{project.softwareManagers.length > 0
            ? `可联系项目软件经理 ${project.softwareManagers.map((person) => person.name).join("、")} 或系统管理员核对流程分工。`
            : "请联系系统管理员分配项目流程权限。"}</p>
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
  const batchScope = getBatchEvidenceReadScope(user);
  const pending = currentProject ? getPendingTransferGroups([projectId])[0]?.items.length ?? 0 : 0;
  const batches = currentProject ? getProjectBatchCounts(projectId, canPrepare) : { draft: 0, inTest: 0 };
  const ready = canPrepare ? getTrialReadyVersions([projectId]).length : 0;
  const releaseCounts = currentProject ? getProjectTrialAndFormalCounts(projectId) : null;
  const stages = [
    {
      label: "转测",
      metric: { count: pending, label: "待安排" },
      detail: batches.draft > 0 ? `${batches.draft} 个批次待发起` : undefined,
      href: "/submissions",
      view: pending === 0 && batches.draft > 0 ? "drafts" : undefined,
    },
    { label: "集成测试", metric: { count: batches.inTest, label: "在测" }, href: "/integration" },
    ...(canPrepare ? [{ label: "待发布试制", metric: { count: ready, label: "个版本" }, href: "/trial" }] : []),
    { label: "节点绑定", metric: { count: releaseCounts?.binding.total ?? 0, label: "个版本" }, href: "/trial", view: "binding", overdue: releaseCounts?.binding.overdue },
    { label: "待转正", metric: { count: releaseCounts?.formal.total ?? 0 }, href: "/formal", overdue: releaseCounts?.formal.overdue },
  ];

  return (
    <div className={styles.projectOverview}>
      {projectHeader}

      {currentProject && (
        <section className={styles.metricGrid} data-show-trial-release={canPrepare || undefined} aria-label="当前流程">
          {stages.map(({ label, metric, detail, href, view, overdue }) => (
            <Link
              key={label}
              id={view === "binding" ? "trials" : undefined}
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
          {recentBatches.length === 0 ? <EmptyState title="暂无集成测试批次" action={canPrepare
            ? <Link href={scopedHref("/submissions")} className="button button-secondary button-sm" prefetch={false}>查看待安排申请</Link>
            : undefined} /> : (
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
          {projectVersions.length === 0 ? <EmptyState title="暂无项目版本记录" action={currentProject
            ? <Link href={scopedHref("/submissions/transfer")} className="button button-secondary button-sm" prefetch={false}>提交转测申请</Link>
            : undefined} /> : (
            <ul className={styles.activityList}>
              {projectVersions.map((version) => {
                const status = projectVersionStatus(version.status);
                const batch = getReadableLinkedBatchEvidence(user, version, batchScope);
                const { code } = packageIdentity({ code: version.packageCode, name: version.packageName });
                return (
                  <li key={version.requestId} className={styles.activityItem}>
                    <div className={styles.activityMain}>
                      <div>
                        <Link href={scopedHref(`/versions/${version.versionId}`)} className="mono" prefetch={false}>{code} {version.version}</Link>
                      </div>
                      {batch?.batchCode && <p>集成批次 <span className="mono">{batch.batchCode}</span></p>}
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
          <EmptyState title="暂无关联软件包" description={currentProject ? "由责任田主管或管理员为软件包关联本项目的测试节点。" : undefined}
            action={currentProject
              ? <Link href={user.role === "ADMIN" ? "/settings/packages" : "/settings/areas"} className="button button-secondary button-sm" prefetch={false}>
                {user.role === "ADMIN" ? "查看软件包配置" : "查看责任田分工"}
              </Link> : undefined} />
        ) : (
          <div className="table-wrap" tabIndex={0} role="region" aria-label="项目软件包表，可横向滚动">
            <table className={`data-table ${styles.packageTable}`}>
              <thead><tr><th scope="col">软件包编码</th><th scope="col">正式版</th><th scope="col">试制版</th><th scope="col">本项目节点</th><th scope="col">全部项目使用范围</th></tr></thead>
              <tbody>
                {packageRows.slice(0, previewLength).map((pkg) => {
                  const localUsage = pkg.usages.find((usage) => usage.projectId === projectId);
                  const { code, name } = packageIdentity(pkg);
                  return (
                    <tr key={pkg.id}>
                      <th scope="row">
                        <Link href={scopedHref("/packages", { open: pkg.id })} className={`mono ${styles.tableLink} ${identityStyles.code}`} prefetch={false} title={name === code ? undefined : name}>{code}</Link>
                        <div className={styles.secondaryText}>{pkg.areaName ?? "未归属"}</div>
                      </th>
                      <td className={`mono ${styles.packageVersion}`}>{pkg.formalVersion ?? "—"}</td>
                      <td className={`mono ${styles.packageVersion}`}>
                        {pkg.trialVersions.length ? <ul className="version-stack">{pkg.trialVersions.map((version) => <li key={version}>{version}</li>)}</ul> : "—"}
                      </td>
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
