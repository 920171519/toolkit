import "server-only";

import { all, run } from "./db";

export function markNotificationRead(userId: number, notificationKey: string): void {
  const key = notificationKey.slice(0, 200);
  if (!key) return;
  run(
    "INSERT OR IGNORE INTO notification_reads (user_id, notification_key, read_at) VALUES (?, ?, ?)",
    userId, key, new Date().toISOString(),
  );
}

export function getReadNotificationKeys(userId: number): Set<string> {
  return new Set(all<{ notificationKey: string }>(
    "SELECT notification_key AS notificationKey FROM notification_reads WHERE user_id = ?",
    userId,
  ).map((row) => row.notificationKey));
}
