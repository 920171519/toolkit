"use client";

import { useSearchParams } from "next/navigation";
import { PackageDrawer, type DrawerPayload } from "@/components/package-drawer";
import type { PersonOption } from "@/lib/queries";

function closePackage() {
  const url = new URL(window.location.href);
  url.searchParams.delete("open");
  window.history.replaceState(null, "", url.toString());
}

export function PackageOverviewDrawer({ people, projectId, initialDetail }: {
  people: PersonOption[];
  projectId?: number;
  initialDetail: DrawerPayload | null;
}) {
  const openId = Number(useSearchParams().get("open"));
  if (!Number.isSafeInteger(openId) || openId < 1) return null;
  return (
    <PackageDrawer
      key={openId}
      packageId={openId}
      projectId={projectId}
      people={people}
      onClose={closePackage}
      initialDetail={initialDetail?.package.id === openId ? initialDetail : null}
    />
  );
}
