import { ActionForm } from "@/components/action-form";
import { FormDialog } from "@/components/form-dialog";
import { voidPackageVersionAction } from "@/lib/actions/release";

export function VersionVoidDialog({
  versionId,
  code,
  version,
  returnFields = {},
  buttonLabel = "作废版本",
  triggerClassName = "button button-outline-danger",
  description = "该版本将在所有关联项目中失效。未完成的转测与节点绑定将关闭，批次、报告和电子流记录会保留。",
}: {
  versionId: number;
  code: string;
  version: string;
  returnFields?: Record<string, string | number | undefined>;
  buttonLabel?: string;
  triggerClassName?: string;
  description?: string;
}) {
  return (
    <FormDialog label={buttonLabel} title={`作废 ${code} ${version}`} description={description} triggerClassName={triggerClassName} cancelLabel="取消">
      <ActionForm action={voidPackageVersionAction} hidden={{ ...returnFields, versionId }}
        submitText={returnFields.voidFrom === "trial" ? "确认作废共享试制版本" : "确认作废该版本"} submitVariant="danger">
        <label className="field">
          <span className="label">作废原因 <span className="required-mark" aria-hidden="true">*</span></span>
          <textarea className="textarea" name="reason" required minLength={5} />
        </label>
      </ActionForm>
    </FormDialog>
  );
}
