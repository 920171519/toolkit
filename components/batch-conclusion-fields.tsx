"use client";

import { useState } from "react";
import { readTestReport, testReportAccept, testReportHint } from "@/lib/test-report-validation";
import styles from "./workflow-queue.module.css";

type TestedVersion = {
  versionId: number;
  packageName: string;
  version: string;
  parallelRiskTrial: boolean;
};

export function BatchConclusionFields({ items }: { items: TestedVersion[] }) {
  const [conclusion, setConclusion] = useState("");
  const [attribution, setAttribution] = useState("");
  const [affected, setAffected] = useState(new Set<number>());
  const showAffectedVersions =
    conclusion === "FAIL" && attribution === "PACKAGE_RELATED" && items.some((item) => item.parallelRiskTrial);

  return (
    <>
      <label className="field">
        <span className="label">测试结论</span>
        <select className="select" name="conclusion" value={conclusion} required onChange={(event) => {
          setConclusion(event.target.value);
          setAttribution("");
          setAffected(new Set());
        }}>
          <option value="" disabled>请选择</option>
          <option value="PASS">测试通过</option>
          <option value="FAIL">测试不通过</option>
          <option value="BLOCKED">无法完成验证</option>
        </select>
      </label>
      {conclusion === "FAIL" ? <label className="field">
        <span className="label">问题归属</span>
        <select className="select" name="issueAttribution" value={attribution} required onChange={(event) => {
          setAttribution(event.target.value);
          setAffected(new Set());
        }}>
          <option value="" disabled>请选择</option>
          <option value="PACKAGE_RELATED">问题与软件包相关</option>
          <option value="NOT_PACKAGE_RELATED">问题与软件包无关</option>
        </select>
      </label> : <input type="hidden" name="issueAttribution" value={conclusion === "BLOCKED" ? "UNKNOWN" : "NONE"} />}
      {showAffectedVersions && (
        <fieldset className="field">
          <legend className="label">受影响的软件包版本 · 至少选择一项</legend>
          <p className="risk-callout">提交后，选中的风险试制版本会被作废，相关绑定电子流需要撤销。</p>
          {items.map((item, index) => (
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
              <span className={styles.packageChoiceLabel}>{item.packageName} {item.version}{item.parallelRiskTrial ? " · 风险试制中" : ""}</span>
            </label>
          ))}
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
