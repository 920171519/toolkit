import "server-only";

import { canEditPackageResponsibility, canManagePackageArea } from "./access";
import { createAuditLogWriter } from "./audit-log";
import { all, db, one, run, transaction } from "./db";
import { assert } from "./domain-error";
import { isStandardPackageCode, packageIdentity } from "./package-identity";
import { isAdmin } from "./permissions";
import {
  getLegacyVersionForCorrection,
  getPackageDeactivationBlockingVersions,
  getPackageUsageBlockingVersions,
  type LegacyReleaseStatus,
  type LegacyVersionMetadata,
} from "./settings-queries";
import { backfillTrialTransferRequests, refreshScopedPendingVersions } from "./transfer-requests";
import type { SessionUser } from "./types";

const audit = createAuditLogWriter(db);

function assertPackageCanDeactivate(packageId: number, isActive: (flag: number) => boolean) {
  const current = one<{ active: number }>("SELECT is_active AS active FROM packages WHERE id = ?", packageId);
  if (current && isActive(current.active)) {
    assert(getPackageDeactivationBlockingVersions(packageId).length === 0, "该软件包仍有未转正版本记录，不能停用。");
  }
}

export type SavePackageInput = {
  id?: number;
  name: string;
  code: string;
  description: string;
  areaId: number | null;
  ownerId: number | null;
  isActive: boolean;
  trialOverdueDays: number;
};

export function savePackage(actor: SessionUser, input: SavePackageInput): number {
  const existingPackage = input.id
    ? one<{ id: number; area_id: number | null; name: string; code: string }>("SELECT id, area_id, name, code FROM packages WHERE id = ?", input.id)
    : null;
  if (input.id) {
    assert(existingPackage, "软件包不存在。", "NOT_FOUND");
    assert(
      canManagePackageArea(actor, existingPackage.area_id),
      "只有责任田主管或系统管理员可以维护该软件包。",
      "FORBIDDEN",
    );
    assert(
      input.areaId === existingPackage.area_id || isAdmin(actor),
      "只有系统管理员可以调整软件包所属责任田。",
      "FORBIDDEN",
    );
  } else {
    assert(
      canManagePackageArea(actor, input.areaId),
      "只有责任田主管或系统管理员可以在该责任田下新建软件包。",
      "FORBIDDEN",
    );
  }
  const name = input.name.trim();
  const code = input.code.trim().toUpperCase();
  const current = existingPackage ? packageIdentity(existingPackage) : null;
  const unchangedCode = current?.code.toUpperCase() === code;
  assert(name.length >= 2, "软件包名称至少需要 2 个字符。");
  assert(unchangedCode || isStandardPackageCode(code), "软件包编码需要 5 位数字加 3 位字母，例如 10001OTA。");
  const identityChanged = current?.name !== name || !unchangedCode;
  const identity = existingPackage && !identityChanged ? existingPackage : { name, code };
  assert(input.ownerId, "请为软件包指定责任人。");
  assert(
    Number.isInteger(input.trialOverdueDays) && input.trialOverdueDays >= 1 && input.trialOverdueDays <= 365,
    "试制超期天数需为 1-365 的整数。",
  );
  const owner = one<{ id: number }>("SELECT id FROM users WHERE id = ? AND is_active = 1", input.ownerId);
  assert(owner, "责任人不存在或已停用。");
  if (input.areaId) {
    const area = one<{ id: number }>("SELECT id FROM areas WHERE id = ?", input.areaId);
    assert(area, "责任田不存在。");
  }
  return transaction(() => {
    if (input.id && !input.isActive) {
      assertPackageCanDeactivate(input.id, Boolean);
    }
    if (identityChanged) {
      const matches = all<{ name: string; code: string }>(
        "SELECT name, code FROM packages WHERE id != ? AND (UPPER(code) = ? OR UPPER(name) = ?)",
        input.id ?? -1, code, code,
      );
      assert(!matches.some((pkg) => packageIdentity(pkg).code.toUpperCase() === code), "软件包编码已存在。");
    }
    let packageId = input.id ?? 0;
    if (packageId) {
      const existing = one<{ id: number }>("SELECT id FROM packages WHERE id = ?", packageId);
      assert(existing, "软件包不存在。", "NOT_FOUND");
      run(
        "UPDATE packages SET name = ?, code = ?, description = ?, area_id = ?, owner_id = ?, is_active = ?, trial_overdue_days = ? WHERE id = ?",
        identity.name,
        identity.code,
        input.description.trim(),
        input.areaId,
        input.ownerId,
        input.isActive ? 1 : 0,
        input.trialOverdueDays,
        packageId,
      );
    } else {
      const result = run(
        `INSERT INTO packages (name, code, description, area_id, owner_id, is_active, trial_overdue_days, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        identity.name,
        identity.code,
        input.description.trim(),
        input.areaId,
        input.ownerId,
        input.isActive ? 1 : 0,
        input.trialOverdueDays,
        new Date().toISOString(),
      );
      packageId = Number(result.lastInsertRowid);
    }
    audit(
      actor.id,
      input.id ? "UPDATE_PACKAGE" : "CREATE_PACKAGE",
      "PACKAGE",
      packageId,
      `${input.id ? "更新" : "创建"}软件包：${code} · ${name}`,
    );
    return packageId;
  });
}


type LegacyVersionMetadataInput = {
  changeSummary: string;
  archiveUrl: string;
  buildUrl: string;
  trialFormNo: string;
  trialReleasedAt: string;
  formFlowNo: string;
  formalReleasedAt: string;
};

export type ImportLegacyVersionInput = LegacyVersionMetadataInput & {
  packageId: number;
  version: string;
  status: LegacyReleaseStatus;
};

function legacyVersionMetadata(input: LegacyVersionMetadataInput, status: LegacyReleaseStatus): LegacyVersionMetadata {
  const changeSummary = input.changeSummary.trim();
  const archiveUrl = input.archiveUrl.trim();
  const buildUrl = input.buildUrl.trim();
  const trialFormNo = input.trialFormNo.trim() || null;
  const formFlowNo = input.formFlowNo.trim() || null;
  assert(changeSummary.length >= 2, "请填写版本说明/修复内容。");
  assert(/^https?:\/\//i.test(archiveUrl), "归档链接必须以 http:// 或 https:// 开头。");
  assert(/^https?:\/\//i.test(buildUrl), "构建地址必须以 http:// 或 https:// 开头。");
  const toIso = (value: string, label: string) => {
    const parsed = value ? new Date(value) : null;
    assert(parsed && !Number.isNaN(parsed.getTime()), `请填写有效的${label}。`);
    return parsed.toISOString();
  };
  let formalReleasedAt: string | null = null;
  if (status === "FORMAL") {
    assert(formFlowNo && formFlowNo.length >= 3, "请填写转正电子流。");
    formalReleasedAt = toIso(input.formalReleasedAt, "转正日期");
  } else {
    assert(trialFormNo && trialFormNo.length >= 3, "请填写试制电子流。");
  }

  return {
    changeSummary,
    archiveUrl,
    buildUrl,
    trialFormNo,
    trialReleasedAt: trialFormNo ? toIso(input.trialReleasedAt, "试制发布日期") : null,
    formFlowNo,
    formalReleasedAt,
  };
}

export function importLegacyVersion(actor: SessionUser, input: ImportLegacyVersionInput): number {
  const pkg = one<{ id: number; name: string; code: string; area_id: number | null }>(
    "SELECT id, name, code, area_id FROM packages WHERE id = ?",
    input.packageId,
  );
  assert(pkg, "软件包不存在。", "NOT_FOUND");
  assert(
    canManagePackageArea(actor, pkg.area_id),
    "只有责任田主管或系统管理员可以导入历史版本。",
    "FORBIDDEN",
  );
  const version = input.version.trim();
  assert(version.length >= 1 && version.length <= 40, "版本号需为 1-40 个字符。");
  const duplicate = one<{ id: number }>(
    "SELECT id FROM package_versions WHERE package_id = ? AND UPPER(version) = UPPER(?)",
    input.packageId,
    version,
  );
  assert(!duplicate, "该软件包已存在相同版本号。");
  const metadata = legacyVersionMetadata(input, input.status);
  const timestamp = new Date().toISOString();
  return transaction(() => {
    const result = run(
      `INSERT INTO package_versions
        (package_id, version, change_summary, archive_url, build_url, status, submitted_by, submitted_at,
         trial_form_no, trial_released_at, formal_released_at, form_flow_no, release_mode,
         binding_mode, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INTEGRATION', 'SKIPPED', ?)`,
      input.packageId,
      version,
      metadata.changeSummary,
      metadata.archiveUrl,
      metadata.buildUrl,
      input.status,
      actor.id,
      timestamp,
      metadata.trialFormNo,
      metadata.trialReleasedAt,
      metadata.formalReleasedAt,
      metadata.formFlowNo,
      timestamp,
    );
    const versionId = Number(result.lastInsertRowid);
    audit(
      actor.id,
      "IMPORT_LEGACY_VERSION",
      "PACKAGE_VERSION",
      versionId,
      `导入历史版本：${pkg.name} ${version}（${input.status === "FORMAL" ? "已转正" : "试制中"}）`,
    );
    return versionId;
  });
}

export function correctLegacyVersion(
  actor: SessionUser,
  packageId: number,
  versionId: number,
  input: LegacyVersionMetadataInput & { expectedUpdatedAt: string; reason: string },
) {
  assert(isAdmin(actor), "只有系统管理员可以更正历史版本。", "FORBIDDEN");
  const reason = input.reason.trim();
  assert(reason.length >= 5 && reason.length <= 1000, "更正原因需为 5–1000 个字符。");

  transaction(() => {
    const current = getLegacyVersionForCorrection(packageId, versionId);
    assert(current, "当前版本无法更正。仅支持尚未被流程引用的历史补录版本。");
    assert(input.expectedUpdatedAt === current.updatedAt, "版本资料已更新，请刷新后再提交。");
    const before = {
      changeSummary: current.changeSummary,
      archiveUrl: current.archiveUrl,
      buildUrl: current.buildUrl,
      trialFormNo: current.trialFormNo,
      trialReleasedAt: current.trialReleasedAt,
      formFlowNo: current.formFlowNo,
      formalReleasedAt: current.formalReleasedAt,
    };
    const after = legacyVersionMetadata(input, current.status);
    if (current.status === "TRIAL") after.formFlowNo = current.formFlowNo;
    assert(JSON.stringify(before) !== JSON.stringify(after), "版本资料没有变化。");
    const previousTimestamp = Date.parse(current.updatedAt);
    const timestamp = new Date(Math.max(Date.now(), Number.isFinite(previousTimestamp) ? previousTimestamp + 1 : 0)).toISOString();
    run(
      `UPDATE package_versions
       SET change_summary = ?, archive_url = ?, build_url = ?, trial_form_no = ?, trial_released_at = ?,
           form_flow_no = ?, formal_released_at = ?, updated_at = ?
       WHERE id = ?`,
      after.changeSummary,
      after.archiveUrl,
      after.buildUrl,
      after.trialFormNo,
      after.trialReleasedAt,
      after.formFlowNo,
      after.formalReleasedAt,
      timestamp,
      versionId,
    );
    audit(actor.id, "CORRECT_LEGACY_VERSION", "PACKAGE_VERSION", versionId,
      JSON.stringify({ packageId, version: current.version, status: current.status, reason, before, after }));
  });
}

export type UpdatePackageResponsibilityInput = {
  ownerId: number | null;
  description: string;
  isActive: boolean;
};

export function updatePackageResponsibility(
  actor: SessionUser,
  packageId: number,
  input: UpdatePackageResponsibilityInput,
) {
  const pkg = one<{
    id: number;
    name: string;
    area_id: number | null;
    owner_id: number | null;
  }>(
    "SELECT id, name, area_id, owner_id FROM packages WHERE id = ?",
    packageId,
  );
  assert(pkg, "软件包不存在。", "NOT_FOUND");
  assert(
    canEditPackageResponsibility(actor, pkg.area_id),
    "只有责任田主管、项目负责人或系统管理员可以修改软件包责任信息。",
    "FORBIDDEN",
  );
  assert(input.ownerId, "请为软件包指定责任人。");
  const owner = one<{ id: number }>(
    "SELECT id FROM users WHERE id = ? AND is_active = 1",
    input.ownerId,
  );
  assert(owner, "责任人不存在或已停用。");
  transaction(() => {
    if (!input.isActive) {
      // The drawer has historically treated only a stored 1 as enabled.
      assertPackageCanDeactivate(packageId, (flag) => flag === 1);
    }
    run(
      "UPDATE packages SET owner_id = ?, description = ?, is_active = ? WHERE id = ?",
      input.ownerId,
      input.description.trim(),
      input.isActive ? 1 : 0,
      packageId,
    );
    audit(
      actor.id,
      "UPDATE_PACKAGE_RESPONSIBILITY",
      "PACKAGE",
      packageId,
      `更新 ${pkg.name} 责任信息：责任人 ${input.ownerId}，状态 ${input.isActive ? "启用" : "停用"}`,
    );
  });
}

export function savePackageUsages(actor: SessionUser, packageId: number, nodeIds: number[]) {
  const uniqueNodeIds = [...new Set(nodeIds)];
  return transaction(() => {
    const pkg = one<{ id: number; name: string; area_id: number | null }>(
      "SELECT id, name, area_id FROM packages WHERE id = ?",
      packageId,
    );
    assert(pkg, "软件包不存在。", "NOT_FOUND");
    assert(canManagePackageArea(actor, pkg.area_id), "只有责任田主管或系统管理员可以维护该软件包使用范围。", "FORBIDDEN");
    const [blockingVersion] = getPackageUsageBlockingVersions(packageId);
    assert(!blockingVersion, `该软件包 ${blockingVersion?.version ?? ""} 正在试制或待转正，暂不能调整项目节点范围。`);
    const nodes = uniqueNodeIds.length
      ? all<{ id: number; project_id: number }>(
        `SELECT id, project_id FROM project_nodes WHERE id IN (${uniqueNodeIds.map(() => "?").join(",")})`,
        ...uniqueNodeIds,
      )
      : [];
    assert(nodes.length === uniqueNodeIds.length, "选择的项目节点中包含无效数据。");
    run("DELETE FROM package_usages WHERE package_id = ?", packageId);
    for (const node of nodes) {
      run(
        "INSERT INTO package_usages (package_id, project_id, node_id) VALUES (?, ?, ?)",
        packageId,
        node.project_id,
        node.id,
      );
    }
    const backfilled = backfillTrialTransferRequests(db, actor.id, { packageId });
    refreshScopedPendingVersions(db, { packageId });
    audit(
      actor.id,
      "UPDATE_PACKAGE_USAGE",
      "PACKAGE",
      packageId,
      `更新 ${pkg.name} 使用范围，共 ${nodes.length} 个项目测试节点`,
    );
    return backfilled.length;
  });
}
