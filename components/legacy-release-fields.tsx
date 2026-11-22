"use client";

import { useState } from "react";

export function LegacyReleaseFields() {
  const [status, setStatus] = useState<"FORMAL" | "TRIAL">("FORMAL");
  const [includeTrial, setIncludeTrial] = useState(false);
  const isFormal = status === "FORMAL";
  const trialVisible = !isFormal || includeTrial;

  return (
    <>
      <div className="field span-2"><label className="label" htmlFor="legacy-version-status">历史状态</label><select id="legacy-version-status" className="select" name="status" value={status} onChange={(event) => setStatus(event.target.value === "TRIAL" ? "TRIAL" : "FORMAL")}>
        <option value="FORMAL">已转正</option><option value="TRIAL">试制中</option>
      </select></div>
      <label className="field" hidden={!isFormal}><span className="label">转正电子流 <span className="required-mark" aria-hidden="true">*</span></span><input className="input" name="formFlowNo" disabled={!isFormal} required={isFormal} minLength={3} /></label>
      <label className="field" hidden={!isFormal}><span className="label">转正日期 <span className="required-mark" aria-hidden="true">*</span></span><input className="input" name="formalReleasedAt" type="date" disabled={!isFormal} required={isFormal} /></label>
      {isFormal && <label className="check-item span-2"><input type="checkbox" checked={includeTrial} onChange={(event) => setIncludeTrial(event.target.checked)} /> 同时补录试制记录</label>}
      <label className="field" hidden={!trialVisible}><span className="label">试制电子流 <span className="required-mark" aria-hidden="true">*</span></span><input className="input" name="trialFormNo" disabled={!trialVisible} required={trialVisible} minLength={isFormal ? 1 : 3} /></label>
      <label className="field" hidden={!trialVisible}><span className="label">试制发布日期 <span className="required-mark" aria-hidden="true">*</span></span><input className="input" name="trialReleasedAt" type="date" disabled={!trialVisible} required={trialVisible} /></label>
    </>
  );
}
