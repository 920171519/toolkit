import { SettingsSelect } from "@/components/settings-select";
import type { SettingsPerson } from "@/components/settings-person-picker";
import type { ProjectConfig } from "@/lib/project-queries";
import type { PersonOption } from "@/lib/organization-queries";

type NodeFieldDefaults = Pick<
  ProjectConfig["nodes"][number],
  "name" | "description" | "bindingOwnerId" | "bindingApproverId" | "requiredBindingCount"
>;

export function formatNodePersonOptions(people: PersonOption[]): SettingsPerson[] {
  return people.map(({ id, name, employeeId }) => ({ id, label: `${name} · ${employeeId}` }));
}

export function SettingsNodeFields({ options, node }: { options: SettingsPerson[]; node?: NodeFieldDefaults }) {
  return (
    <div className="form-grid">
      <label className="field"><span className="label">节点名称</span><input className="input" name="name" defaultValue={node?.name} placeholder="例如 EVT" maxLength={20} required /></label>
      <label className="field"><span className="label">节点说明</span><input className="input" name="description" defaultValue={node?.description} placeholder="例如 工程验证" /></label>
      <SettingsSelect name="bindingOwnerId" label="绑定验证责任人" options={options} defaultValue={node?.bindingOwnerId ?? ""} />
      <SettingsSelect name="bindingApproverId" label="主审批人" options={options} defaultValue={node?.bindingApproverId ?? ""} />
      <label className="field"><span className="label">绑定通过数量要求</span><input className="input" type="number" name="requiredBindingCount" min={1} max={20} defaultValue={node?.requiredBindingCount ?? 1} required /></label>
    </div>
  );
}
