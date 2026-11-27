"use client";

import { useState } from "react";
import { ATTRIBUTION_META, CONCLUSION_META, type BatchConclusion } from "@/lib/constants";
import { integrationAttributionRules, integrationConclusionImpact, isBatchConclusion } from "@/lib/integration-conclusion";
import { packageIdentity } from "@/lib/package-identity";
import { readTestReport, testReportAccept, testReportHint } from "@/lib/test-report-validation";
import styles from "./workflow-queue.module.css";

type TestedVersion = {
  versionId: number;
  packageName: string;
  packageCode: string;
  version: string;
  parallelRiskTrial: boolean;
};

export function BatchConclusionFields({ items }: { items: TestedVersion[] }) {
  const [conclusion, setConclusion] = useState<BatchConclusion | "">("");
  const [attribution, setAttribution] = useState("");
  const [affected, setAffected] = useState(new Set<number>());
  const { choices } = integrationAttributionRules[conclusion || "PASS"];
  const { requiresAffectedVersions: showAffectedVersions } = integrationConclusionImpact(conclusion, attribution, items);

  return (
    <>
      <label className="field">
        <span className="label">测试结论</span>
        <select className="select" name="conclusion" value={conclusion} required onChange={(event) => {
          const value = event.currentTarget.value;
          setConclusion(isBatchConclusion(value) ? value : "");
          setAttribution("");
          setAffected(new Set());
        }}>
          <option value="" disabled>请选择</option>
          {Object.entries(CONCLUSION_META).map(([value, { label }]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      {choices.length > 1 ? <label className="field">
        <span className="label">问题归属</span>
        <select className="select" name="issueAttribution" value={attribution} required onChange={(event) => {
          setAttribution(event.target.value);
          setAffected(new Set());
        }}>
          <option value="" disabled>请选择</option>
          {choices.map((value) => <option key={value} value={value}>{ATTRIBUTION_META[value].label}</option>)}
        </select>
      </label> : <input type="hidden" name="issueAttribution" value={choices[0]} />}
      {showAffectedVersions && (
        <fieldset className="field">
          <legend className="label">受影响的软件包版本 · 至少选择一项</legend>
          <p className="risk-callout">提交后，选中的风险试制版本会被作废，相关绑定电子流需要撤销。</p>
          {items.map((item, index) => {
            const { code, name } = packageIdentity({ name: item.packageName, code: item.packageCode });
            return (
              <label key={item.versionId} className={styles.affectedVersion}>
                <input type="checkbox" name="affectedVersionId" value={item.versionId} checked={affected.has(item.versionId)}
                  required={index === 0 && affected.size === 0}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setAffected((current) => {
                      const next = new Set(current);
                      if (checked) next.add(item.versionId);
                      else next.delete(item.versionId);
                      return next;
                    });
                  }} />
                <span className={styles.packageChoiceLabel}>
                  <strong className="mono">{code} {item.version}</strong>{item.parallelRiskTrial && " · 风险试制中"}
                  {name !== code && <span className="small muted"> · {name}</span>}
                </span>
              </label>
            );
          })}
        </fieldset>
      )}
    </>
  );
}

export function BatchReportField() {
  const [error, setError] = useState("");
  return <div className="field">
    <label className="label" htmlFor="test-report">验证报告 <span className="required-mark" aria-hidden="true">*</span></label>
    <input id="test-report" className={`input ${styles.testUpload}`} name="reportFile" type="file" required
      accept={testReportAccept} aria-invalid={Boolean(error)} aria-describedby={error ? "report-constraints report-error" : "report-constraints"}
      onChange={(event) => {
        const input = event.currentTarget;
        const file = input.files?.[0];
        const message = file ? readTestReport(file).error ?? "" : "";
        input.setCustomValidity(message);
        setError(message);
      }} />
    <span id="report-constraints" className="hint">{testReportHint}</span>
    {error && <span id="report-error" className="form-error" role="alert">{error}</span>}
  </div>;
}
