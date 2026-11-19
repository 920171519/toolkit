"use client";

import { useState } from "react";

type TestedVersion = {
  versionId: number;
  packageName: string;
  version: string;
  parallelRiskTrial: boolean;
};

export function BatchConclusionFields({ items }: { items: TestedVersion[] }) {
  const [conclusion, setConclusion] = useState("PASS");
  const [attribution, setAttribution] = useState("NONE");
  const showAffectedVersions =
    conclusion === "FAIL" && attribution === "PACKAGE_RELATED" && items.some((item) => item.parallelRiskTrial);

  return (
    <>
      <label className="field">
        <span className="label">测试结论</span>
        <select className="select" name="conclusion" value={conclusion} onChange={(event) => setConclusion(event.target.value)}>
          <option value="PASS">测试通过</option>
          <option value="FAIL">测试不通过</option>
          <option value="BLOCKED">无法完成验证</option>
        </select>
      </label>
      <label className="field">
        <span className="label">问题归属</span>
        <select className="select" name="issueAttribution" value={attribution} onChange={(event) => setAttribution(event.target.value)}>
          <option value="NONE">未发现问题</option>
          <option value="PACKAGE_RELATED">问题与软件包相关</option>
          <option value="NOT_PACKAGE_RELATED">问题与软件包无关</option>
          <option value="UNKNOWN">原因待定位 / 无测试条件</option>
        </select>
      </label>
      {showAffectedVersions && (
        <fieldset className="field">
          <legend className="label">受影响的软件包版本</legend>
          <p className="note">请选择导致测试不通过的版本。所选的风险试制版本将同步作废。</p>
          {items.map((item) => (
            <label key={item.versionId} className="toolbar" style={{ gap: 7 }}>
              <input type="checkbox" name="affectedVersionId" value={item.versionId} defaultChecked={items.length === 1} />
              <span>{item.packageName} {item.version}{item.parallelRiskTrial ? " · 风险试制中" : ""}</span>
            </label>
          ))}
        </fieldset>
      )}
    </>
  );
}
