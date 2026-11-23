import { ActionForm } from "@/components/action-form";
import { FormDialog } from "@/components/form-dialog";
import { Badge } from "@/components/ui";
import { admitRiskTrialAction } from "@/lib/actions/workflow";
import { packageIdentity } from "@/lib/package-identity";
import type { RiskTrialEntry, RiskTrialEntryStage } from "@/lib/trial-risk-entry";
import { WorkflowPackageName } from "./workflow-package-name";

const stageLabel: Record<RiskTrialEntryStage, string> = {
  PENDING: "待转测",
  IN_TEST: "集成测试中",
  FAILED: "测试未通过",
  BLOCKED: "无法完成验证",
  PASSED_NO_EVIDENCE: "缺少正式验收记录",
};

export function RiskTrialEntryAction({ entry, packageName, packageCode, version, projectName, returnTo }: {
  entry: RiskTrialEntry;
  packageName: string;
  packageCode: string;
  version: string;
  projectName: string;
  returnTo?: string;
}) {
  if (entry.registered) return <Badge tone="amber">已登记风险原因</Badge>;
  const identity = packageIdentity({ name: packageName, code: packageCode });
  return (
    <FormDialog
      label="登记风险原因"
      title="登记风险试制原因"
      description={`${identity.code} ${version} · ${projectName} · ${stageLabel[entry.stage]}`}
      triggerClassName="button button-secondary button-sm"
      cancelLabel="取消"
    >
      <WorkflowPackageName {...identity} />
      <ActionForm
        action={admitRiskTrialAction}
        hidden={{ requestId: entry.requestId, stage: entry.stage, batchId: entry.batchId, returnTo }}
        submitText="纳入待发布试制"
      >
        <label className="field">
          <span className="label">风险试制原因 <span className="required-mark" aria-hidden="true">*</span></span>
          <textarea
            name="reason"
            className="textarea"
            required
            minLength={5}
            maxLength={1000}
            rows={4}
            placeholder="未完成的验证、已知问题及风险判断"
          />
        </label>
      </ActionForm>
    </FormDialog>
  );
}
