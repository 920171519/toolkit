import Link from "next/link";
import { ProjectContactPicker } from "@/components/project-contact-picker";
import { InfoTooltip } from "@/components/info-tooltip";
import { PROJECT_STATUS_META } from "@/lib/constants";
import { PROJECT_STATUSES } from "@/lib/domain-values";
import { DEFAULT_PROJECT_STAGE, PROJECT_STAGES, PROJECT_STAGE_META } from "@/lib/project-stage";
import type { ProjectConfig } from "@/lib/project-queries";
import type { PersonOption } from "@/lib/organization-queries";

export const PROJECT_STATUS_OPTIONS = PROJECT_STATUSES.map((value) => ({ value, label: PROJECT_STATUS_META[value].label }));

export function ProjectSettingsFields({ people, project, canAssignManagers }: { people: PersonOption[]; project?: ProjectConfig; canAssignManagers: boolean }) {
  return (
    <div className="form-grid">
      <label className="field"><span className="label">项目名称</span><input className="input" name="name" defaultValue={project?.name} placeholder="例如 星云 N2" minLength={2} required /></label>
      <label className="field"><span className="label">项目编码</span><input className="input" name="code" defaultValue={project?.code} required /></label>
      <ProjectContactPicker label="PM" name="pmUserIds" options={people} defaultSelectedIds={project?.pms.map((person) => person.id)} className="span-2"
        emptyHelp={canAssignManagers ? <>没有启用的候选人员。 <Link href="/settings/users" prefetch={false}>查看人员与角色</Link></> : "请联系管理员启用可担任 PM 的账号。"} />
      {canAssignManagers ? (
        <ProjectContactPicker label="软件经理" name="softwareManagerIds" options={people} defaultSelectedIds={project?.softwareManagers.map((person) => person.id)} className="span-2" />
      ) : (
        <div className="field span-2"><span className="label">软件经理</span><p>{project?.softwareManagers.map((person) => person.name).join("、") || "待指定"}</p></div>
      )}
      <div className="field">
        <span className="settings-label-help">
          <label className="label" htmlFor="settings-project-stage">项目阶段</label>
          <InfoTooltip label="项目阶段说明">阶段和流程状态单独保存。已归档项目在总览显示为「已结束」。</InfoTooltip>
        </span>
        <select id="settings-project-stage" className="select" name="stage" defaultValue={project?.stage ?? DEFAULT_PROJECT_STAGE}>
          {PROJECT_STAGES.map((stage) => <option key={stage} value={stage}>{PROJECT_STAGE_META[stage].label}</option>)}
        </select>
      </div>
      {project ? (
        <div className="field"><label className="label" htmlFor="settings-project-state-edit">流程状态</label><select id="settings-project-state-edit" className="select" name="status" defaultValue={project.status} aria-describedby="settings-project-archive-hint">
          {PROJECT_STATUS_OPTIONS.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
        </select><span className="small muted" id="settings-project-archive-hint">归档后退出新转测和公开联系人列表，历史记录保留。</span></div>
      ) : <input type="hidden" name="status" value="ACTIVE" />}
      <label className="field span-2"><span className="label">项目说明</span><textarea className="textarea" name="description" defaultValue={project?.description} /></label>
    </div>
  );
}
