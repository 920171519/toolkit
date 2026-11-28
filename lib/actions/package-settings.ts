"use server";

import type { ActionState } from "@/lib/action-state";
import { actionUser, checkbox, failure, idList, numberValue, refreshAll, successRedirect, text } from "@/lib/action-helpers";
import {
  correctLegacyVersion,
  importLegacyVersion,
  savePackage,
  savePackageUsages,
  updatePackageResponsibility,
  type LegacyVersionMetadataInput,
} from "@/lib/package-settings";
import { directoryActionHref } from "@/lib/settings-directory";

export async function savePackageAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await actionUser();
  const id = numberValue(formData, "id");
  let packageId: number;
  try {
    packageId = savePackage(user, {
      id: id ?? undefined,
      name: text(formData, "name"),
      code: text(formData, "code"),
      description: text(formData, "description"),
      areaId: numberValue(formData, "areaId"),
      ownerId: numberValue(formData, "ownerId"),
      isActive: checkbox(formData, "isActive"),
      trialOverdueDays: numberValue(formData, "trialOverdueDays") ?? 7,
    });
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  successRedirect(
    directoryActionHref("packages", formData, packageId),
    id ? "软件包信息已更新。" : "软件包已创建，请继续配置使用范围。",
  );
}

function readLegacyVersionMetadata(formData: FormData): LegacyVersionMetadataInput {
  return {
    changeSummary: text(formData, "changeSummary"),
    archiveUrl: text(formData, "archiveUrl"),
    buildUrl: text(formData, "buildUrl"),
    trialFormNo: text(formData, "trialFormNo"),
    trialReleasedAt: text(formData, "trialReleasedAt"),
    formFlowNo: text(formData, "formFlowNo"),
    formalReleasedAt: text(formData, "formalReleasedAt"),
  };
}

export async function importLegacyVersionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await actionUser();
  const packageId = numberValue(formData, "packageId");
  if (!packageId) return { error: "请选择软件包。" };
  const status = text(formData, "status") === "TRIAL" ? "TRIAL" : "FORMAL";
  try {
    importLegacyVersion(user, {
      packageId,
      version: text(formData, "version"),
      status,
      ...readLegacyVersionMetadata(formData),
    });
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  successRedirect(directoryActionHref("packages", formData, packageId), "历史版本已导入，可在软件包详情中查看。");
}

export async function correctLegacyVersionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await actionUser();
  const packageId = numberValue(formData, "packageId");
  const versionId = numberValue(formData, "versionId");
  if (!packageId || !versionId) return { error: "历史版本参数无效。" };
  try {
    correctLegacyVersion(user, packageId, versionId, {
      expectedUpdatedAt: text(formData, "expectedUpdatedAt"),
      reason: text(formData, "reason"),
      ...readLegacyVersionMetadata(formData),
    });
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  successRedirect(directoryActionHref("packages", formData, packageId), "历史版本已更正。");
}

export type PackageResponsibilityState = {
  error?: string;
  success?: string;
};

export async function updatePackageResponsibilityAction(
  _prev: PackageResponsibilityState,
  formData: FormData,
): Promise<PackageResponsibilityState> {
  const user = await actionUser();
  const packageId = numberValue(formData, "packageId");
  if (!packageId) return { error: "软件包参数无效。" };
  try {
    updatePackageResponsibility(user, packageId, {
      ownerId: numberValue(formData, "ownerId"),
      description: text(formData, "description"),
      isActive: checkbox(formData, "isActive"),
    });
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  return { success: "软件包责任信息已更新。" };
}

export async function savePackageUsagesAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await actionUser();
  const packageId = numberValue(formData, "packageId");
  if (!packageId) return { error: "软件包参数无效。" };
  let backfilled: number;
  try {
    backfilled = savePackageUsages(user, packageId, idList(formData, "nodeIds"));
  } catch (error) {
    return failure(error);
  }
  refreshAll();
  successRedirect(directoryActionHref("packages", formData, packageId), backfilled > 0 ? `项目使用范围已更新，已补派 ${backfilled} 条转测申请。` : "项目使用范围已更新。");
}
