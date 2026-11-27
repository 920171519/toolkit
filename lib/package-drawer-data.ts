import "server-only";

import { canEditPackageById } from "./access";
import { getReadablePackageDetail } from "./queries";
import { getPackageDeactivationBlockingVersions } from "./settings";
import type { SessionUser } from "./types";

export function getPackageDrawerData(user: SessionUser, packageId: number, projectId?: number) {
  const detail = getReadablePackageDetail(user, packageId, projectId);
  if (!detail) return null;

  const canEdit = canEditPackageById(user, packageId);
  return {
    ...detail,
    canEdit,
    deactivationBlockers: canEdit ? getPackageDeactivationBlockingVersions(packageId) : [],
  };
}

export type PackageDrawerData = NonNullable<ReturnType<typeof getPackageDrawerData>>;
