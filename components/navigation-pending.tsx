"use client";

import { useLinkStatus } from "next/link";
import { useEffect } from "react";

export function NavigationPending({ transitionPending = false, onPendingChange }: {
  transitionPending?: boolean;
  onPendingChange?: (pending: boolean) => void;
}) {
  const { pending } = useLinkStatus();
  const busy = pending || transitionPending;

  useEffect(() => {
    if (!busy || !onPendingChange) return;
    onPendingChange(true);
    return () => onPendingChange(false);
  }, [busy, onPendingChange]);

  return (
    <span className="workspace-link-pending" data-navigation-pending={busy || undefined} role={onPendingChange ? undefined : "status"}>
      {busy && !onPendingChange && <span className="sr-only">正在加载页面</span>}
    </span>
  );
}
