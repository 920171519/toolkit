"use client";

import { useState } from "react";
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
  const showAffectedVersions =
    conclusion === "FAIL" && attribution === "PACKAGE_RELATED" && items.some((item) => item.parallelRiskTrial);

  return (
    <>
      <label className="field">
        <span className="label">测试结论</span>
        <select className="select" name="conclusion" value={conclusion} required onChange={(event) => {
          setConclusion(event.target.value);
          setAttribution("");
        }}>
          <option value="" disabled>请选择</option>
          <option value="PASS">测试通过</option>
          <option value="FAIL">测试不通过</option>
          <option value="BLOCKED">无法完成验证</option>
        </select>
      </label>
      {conclusion === "FAIL" ? <label className="field">
        <span className="label">问题归属</span>
        <select className="select" name="issueAttribution" value={attribution} required onChange={(event) => setAttribution(event.target.value)}>
          <option value="" disabled>请选择</option>
          <option value="PACKAGE_RELATED">问题与软件包相关</option>
          <option value="NOT_PACKAGE_RELATED">问题与软件包无关</option>
        </select>
      </label> : <input type="hidden" name="issueAttribution" value={conclusion === "BLOCKED" ? "UNKNOWN" : "NONE"} />}
      {showAffectedVersions && (
        <fieldset className="field">
          <legend className="label">受影响的软件包版本</legend>
          <p className="risk-callout">提交后，选中的风险试制版本会被作废，相关绑定电子流需要撤销。</p>
          {items.map((item) => (
            <label key={item.versionId} className={styles.affectedVersion}>
              <input type="checkbox" name="affectedVersionId" value={item.versionId} />
              <span className={styles.packageChoiceLabel}>{item.packageName} {item.version}{item.parallelRiskTrial ? " · 风险试制中" : ""}</span>
            </label>
          ))}
        </fieldset>
      )}
    </>
  );
}
