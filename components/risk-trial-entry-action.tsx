import { ActionForm } from "@/components/action-form";
import { FormDialog } from "@/components/form-dialog";
import { Badge } from "@/components/ui";
import { admitRiskTrialAction } from "@/lib/actions/workflow";
import type { RiskTrialEntry, RiskTrialEntryStage } from "@/lib/trial-risk-entry";

const stageLabel: Record<RiskTrialEntryStage, string> = {
  PENDING: "待转测",
  IN_TEST: "集成测试中",
  FAILED: "测试未通过",
  BLOCKED: "无法完成验证",
  PASSED_NO_EVIDENCE: "缺少正式验收记录",
};

export function RiskTrialEntryAction({ entry, packageName, version, projectName, returnTo }: {
  entry: RiskTrialEntry;
  packageName: string;
  version: string;
  projectName: string;
  returnTo?: string;
}) {
  if (entry.registered) return <Badge tone="amber">已登记风险原因</Badge>;
  return (
    <FormDialog
      label="登记风险原因"
      title={`登记 ${packageName} ${version} 风险试制原因`}
      description={`${projectName} · ${stageLabel[entry.stage]}`}
      triggerClassName="button button-secondary button-sm"
      cancelLabel="取消"
    >
      <ActionForm
        action={admitRiskTrialAction}
        hidden={{ requestId: entry.requestId, stage: entry.stage, batchId: entry.batchId, returnTo }}
        submitText="纳入待发布试制"
      >
        <label className="field">
          <span className="label">风险试制原因 <span className="required-mark">*</span></span>
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
