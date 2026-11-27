import "server-only";

import { getReadablePackageDetail } from "./queries";
import { getPackageDeactivationBlockingVersions } from "./settings-queries";
import type { SessionUser } from "./types";

export function getPackageDrawerData(user: SessionUser, packageId: number, projectId?: number) {
  const detail = getReadablePackageDetail(user, packageId, projectId);
  if (!detail) return null;

  return {
    ...detail,
    deactivationBlockers: detail.canEdit ? getPackageDeactivationBlockingVersions(packageId) : [],
  };
}

export type PackageDrawerData = NonNullable<ReturnType<typeof getPackageDrawerData>>;
