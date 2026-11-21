import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { FormDialog } from "@/components/form-dialog";
import { TrialQueueFilters } from "@/components/trial-queue-filters";
import { TrialQueueTable, type TrialTableColumn } from "@/components/trial-queue-table";
import { Badge, FlashMessage, PageHeader } from "@/components/ui";
import styles from "@/components/trial-queue-table.module.css";
import { canManageProjectWorkflowForProject } from "@/lib/access";
import { abandonTrialReleaseAction, releaseTrialAction } from "@/lib/actions/workflow";
import { requireUser } from "@/lib/auth";
import { requireWorkflowProject } from "@/lib/project-scope";
import { parseFlash } from "@/lib/queries";
import { trialQueueParams, type TrialSearchParams } from "@/lib/trial-queue";
import { trialReleaseStateKey } from "@/lib/trial-release-state";
import { workflowHref } from "@/lib/workflow-links";
import { getTrialReadyVersions, getTrialVersions, getWorkflowProjectScope, type TrialReadyVersion, type TrialVersionRow } from "@/lib/workflow-queries";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "试制与绑定验证" };

function riskRelease(row: TrialReadyVersion) {
  return row.riskProjectCount > 0;
}

function readyStatus(row: TrialReadyVersion) {
  return riskRelease(row) ? "风险发布" : "待发试制";
}

const bindingModes = { PENDING: "待推送绑定", PUSHED: "绑定中", SKIPPED: "跳过绑定" } as const;

function bindingStatus(row: TrialVersionRow) {
  return [
    bindingModes[row.bindingMode],
    (row.releaseMode === "RISK" || !row.batchId) && "风险发布",
    Boolean(row.isOverdue) && "已超期",
  ].filter(Boolean).join(" · ");
}

function batchLink(row: TrialReadyVersion | TrialVersionRow, projectId?: number) {
  if (!row.batchId) return <span className="small muted">未关联转测批次</span>;
  return <Link href={workflowHref("/integration/" + row.batchId, projectId)} className="archive-link" prefetch={false}>
    {row.batchCode ?? "查看批次"}
  </Link>;
}

export default async function TrialPage({ searchParams }: { searchParams: Promise<TrialSearchParams> }) {
  const user = await requireUser();
  const params = await searchParams;
  const notice = parseFlash(params.flash, params.tone === "error" ? "error" : "success");
  const project = requireWorkflowProject(user, params.project);
  const projectId = project?.id;
  const scope = project ? [project.id] : getWorkflowProjectScope(user);
  const query = trialQueueParams(params);
  const canViewReleaseQueue = user.role === "ADMIN" || user.role === "SOFTWARE_MANAGER";
  const ready = canViewReleaseQueue ? getTrialReadyVersions(scope) : [];
  const trials = getTrialVersions(scope);
  const canRelease = (row: TrialReadyVersion) => canManageProjectWorkflowForProject(user, row.projectId);
  const packageLink = (row: TrialReadyVersion | TrialVersionRow) => (
    <Link href={workflowHref("/packages", projectId, { open: row.packageId })} prefetch={false} className="archive-link">{row.packageName}</Link>
  );

  const identityColumns: TrialTableColumn<TrialReadyVersion | TrialVersionRow>[] = [
    { key: "package", label: "软件包", value: (row) => row.packageName, cell: packageLink },
    { key: "version", label: "版本", value: (row) => row.version, cell: (row) => <span className="mono">{row.version}</span> },
    { key: "project", label: "项目", value: (row) => row.projectName },
    {
      key: "batch",
      label: "转测批次",
      value: (row) => row.batchCode ?? "未关联转测批次",
      cell: (row) => batchLink(row, projectId),
    },
    { key: "submitter", label: "提交人", value: (row) => row.submittedByName ?? "未知" },
  ];
  const releaseColumns: TrialTableColumn<TrialReadyVersion>[] = [
    ...identityColumns,
    {
      key: "status",
      label: "发布状态",
      value: readyStatus,
      options: ["待发试制", "风险发布"],
      cell: (row) => <Badge tone={riskRelease(row) ? "rose" : "violet"} dot>{readyStatus(row)}</Badge>,
    },
  ];
  const bindingColumns: TrialTableColumn<TrialVersionRow>[] = [
    ...identityColumns,
    {
      key: "status",
      label: "绑定状态",
      value: bindingStatus,
      cell: (row) => <div>{bindingModes[row.bindingMode]}
        {(row.releaseMode === "RISK" || !row.batchId) && <span className="small muted"> · 风险发布</span>}
        {Boolean(row.isOverdue) && <div><Badge tone="rose">已超期</Badge></div>}
      </div>,
    },
    { key: "form", label: "试制电子流", value: (row) => row.trialFormNo ?? "—" },
    {
      key: "progress",
      label: "完成节点",
      value: (row) => `${row.requirementPassed + row.requirementWaived} / ${row.requirementTotal}`,
      sortValue: (row) => row.requirementTotal > 0 ? (row.requirementPassed + row.requirementWaived) / row.requirementTotal : -1,
      cell: (row) => <div>{row.requirementPassed + row.requirementWaived} / {row.requirementTotal}
        {row.requirementWaived > 0 && <div className="small muted">含 {row.requirementWaived} 个免绑</div>}
      </div>,
    },
    { key: "pending", label: "待审批", value: (row) => row.pendingFlowCount },
  ];

  return (
    <>
      <PageHeader title="试制与绑定验证"
        description="试制按软件包版本共享，绑定按项目节点验证。"
        actions={<>
          {canViewReleaseQueue && <a href="#binding-queue" className="button button-secondary">跳到绑定验证列表</a>}
          <Link href={workflowHref("/packages", projectId)} className="button button-secondary" prefetch={false}>查看版本总览</Link>
        </>} />
      <FlashMessage notice={notice} />

      <TrialQueueFilters projectId={projectId} query={query}>
        {canViewReleaseQueue && <TrialQueueTable
          kind="release" title="待发布试制" rows={ready} columns={releaseColumns} query={query} projectId={projectId}
          rowKey={(row) => row.requestId} details={(row) => [row.packageCode, row.projectCode]}
          emptyTitle="没有待发试制的项目版本"
          actions={(row) => {
            const risk = riskRelease(row);
            const title = row.packageName + " " + row.version;
            return (
              <div className={styles.actions}>
                {canRelease(row) && <>
                  <FormDialog label="发布" title={"发布 " + title + " 试制"}
                    description={"发布后同步到全部 " + row.versionProjectCount + " 个使用项目。"}
                    triggerClassName="button button-primary button-sm" cancelLabel="取消">
                    {risk && <p className="risk-callout" style={{ marginBottom: 10 }}>风险发布原因 · {row.riskConclusion}</p>}
                    <ActionForm action={releaseTrialAction} hidden={{ requestId: row.requestId, scopeProjectId: projectId, eligibility: trialReleaseStateKey(row) }}
                      submitText="发布全项目共享试制版本" submitClassName="button-sm"
                      confirmMessage={"确认发布 " + title + " 共享试制版本？"}>
                      <label className="field">
                        <span className="label">发布试制电子流 <span className="required-mark">*</span></span>
                        <input className="input" name="trialFormNo" required minLength={3} placeholder="例如 EF-TRIAL-N1-OTA-160" />
                      </label>
                    </ActionForm>
                  </FormDialog>
                  <FormDialog label="放弃" title={"放弃发布 " + title + " 试制"}
                    description={risk ? "该版本将退出风险发布队列，待转测申请和集成测试继续进行。" : "该版本将作废，所有使用项目均停止发布该版本。"}
                    triggerClassName="button button-ghost button-sm" cancelLabel="取消">
                    <ActionForm action={abandonTrialReleaseAction} hidden={{ requestId: row.requestId, scopeProjectId: projectId, eligibility: trialReleaseStateKey(row) }}
                      submitText="提交结论并放弃试制" submitVariant="danger" submitClassName="button-sm"
                      confirmMessage={"确认放弃 " + title + " 试制？"}>
                      <label className="field">
                        <span className="label">放弃发布试制结论 <span className="required-mark">*</span></span>
                        <textarea className="textarea" name="conclusion" required minLength={5} />
                      </label>
                    </ActionForm>
                  </FormDialog>
                </>}
                <Link href={workflowHref("/trial/ready/" + row.requestId, projectId, query)} className="button button-secondary button-sm" prefetch={false}>详情</Link>
              </div>
            );
          }}
        />}

        <TrialQueueTable
          kind="binding" title="试制版本绑定验证" rows={trials} columns={bindingColumns} query={query} projectId={projectId}
          rowKey={(row) => row.requestId} details={(row) => [row.packageCode, row.projectCode]}
          emptyTitle="没有正在绑定验证的试制版本"
          actions={(row) => <Link href={workflowHref("/trial/" + row.requestId, projectId, query)} prefetch={false} className="archive-link">
            处理 <ArrowRight size={12} />
          </Link>}
        />
      </TrialQueueFilters>
    </>
  );
}
