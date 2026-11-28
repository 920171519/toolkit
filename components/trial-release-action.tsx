import Link from "next/link";
import { releaseTrialAction } from "@/lib/actions/release";
import { CONCLUSION_META, TRANSFER_REQUEST_STATUS_META, type TransferRequestStatus } from "@/lib/constants";
import type { BatchConclusion } from "@/lib/domain-values";
import { packageIdentity } from "@/lib/package-identity";
import { getTrialNodeGuidance } from "@/lib/release-guidance";
import { trialReleaseStateKey, type TrialReadyDisplayVersion } from "@/lib/trial-eligibility";
import type { SessionUser } from "@/lib/types";
import { workflowHref } from "@/lib/workflow-links";
import { ActionForm } from "./action-form";
import { FormDialog } from "./form-dialog";
import { GuidanceDialog } from "./guidance-dialog";
import { Badge, ExternalLink } from "./ui";
import { WorkflowPackageName } from "./workflow-package-name";
import styles from "./trial-queue-table.module.css";

export function TrialReleaseAction({ actor, row, records, projectId, query = {}, label = "发布", triggerClassName = "button button-secondary button-sm" }: {
  actor: SessionUser;
  row: TrialReadyDisplayVersion;
  records: readonly TrialReadyDisplayVersion[];
  projectId?: number;
  query?: Record<string, string>;
  label?: string;
  triggerClassName?: string;
}) {
  const identity = packageIdentity({ name: row.packageName, code: row.packageCode });
  const title = `${identity.code} ${row.version}`;
  const nodeGuidance = getTrialNodeGuidance(actor, row.packageId);
  const risk = row.riskProjectCount > 0;
  if (nodeGuidance.length > 0) return <GuidanceDialog label={label} title="试制发布条件"
    description={title} items={nodeGuidance} triggerClassName={triggerClassName} />;
  return (
    <FormDialog label={label} title={`发布 ${title} 试制`}
      description={`发布后同步到全部 ${row.versionProjectCount} 个使用项目。`}
      triggerClassName={triggerClassName} cancelLabel="取消">
      <WorkflowPackageName {...identity} />
      <section aria-label="验收依据">
        <h3>验收依据</h3>
        {records.map((record) => {
          const { batch } = record;
          const conclusion = batch?.batchConclusion ? CONCLUSION_META[batch.batchConclusion as BatchConclusion] : null;
          const status = TRANSFER_REQUEST_STATUS_META[record.integrationStatus as TransferRequestStatus];
          return <div className="trial-source-line" key={record.requestId}>
            <strong>{record.projectName}</strong>
            <Badge tone={conclusion?.tone ?? status?.tone ?? "slate"}>{conclusion?.label ?? status?.label ?? "待验收"}</Badge>
            {batch ? <Link href={workflowHref("/integration/" + batch.batchId, batch.batchProjectId)}
              className="archive-link mono" prefetch={false}>{batch.batchCode ?? "查看批次"}</Link>
              : <span className="small muted">{record.hasLinkedBatch ? "—" : "未关联转测批次"}</span>}
            {batch?.reportUrl && <ExternalLink href={batch.reportUrl}>验证报告</ExternalLink>}
            {batch?.testSummary && <span className="small muted trial-summary">{batch.testSummary}</span>}
          </div>;
        })}
        <div className={styles.actions}>
          <ExternalLink href={row.archiveUrl}>归档包</ExternalLink>
          {row.versionProjectCount > records.length && <Link href={workflowHref(`/versions/${row.versionId}`, undefined, { returnTo: query.returnTo })}
            className="archive-link" prefetch={false}>全部项目证据</Link>}
        </div>
        {row.ongoingTestCount > 0 && <p className="note">已有 {row.ongoingTestCount} 个待发起或在测批次，完成前无法转正。</p>}
      </section>
      {risk && <p className="risk-callout" style={{ marginBottom: 10 }}>风险发布原因 · {row.riskConclusion}</p>}
      <ActionForm action={releaseTrialAction}
        hidden={{ ...query, requestId: row.requestId, scopeProjectId: projectId, eligibility: trialReleaseStateKey(row) }}
        submitText="发布全项目共享试制版本" submitClassName="button-sm" preserveValuesOnSubmit
        confirmMessage={`全部 ${row.versionProjectCount} 个使用项目将同步使用 ${title} 试制版本。`}>
        <label className="field">
          <span className="label">试制电子流网址 <span className="required-mark" aria-hidden="true">*</span></span>
          <input className="input" name="trialFormNo" type="url" required placeholder="https://eflow.example.com/trials/160" />
        </label>
        <label className="field">
          <span className="label">试制评审纪要 <span className="required-mark" aria-hidden="true">*</span></span>
          <textarea className="textarea" name="reviewMinutes" required maxLength={2000} />
        </label>
      </ActionForm>
    </FormDialog>
  );
}
