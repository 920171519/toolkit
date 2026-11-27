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

export function getReadNotificationKeys(userId: number, notificationKeys: readonly string[]): Set<string> {
  if (notificationKeys.length === 0) return new Set();

  // Earlier releases used the generic flow notice key for rejected flows.
  const candidates = notificationKeys.map((key) => ({
    key,
    storedKeys: key.startsWith("rejected-flow-") ? [key, key.replace("rejected-flow-", "flow-notice-")] : [key],
  }));
  const readKeys = new Set(all<{ notificationKey: string }>(
    `SELECT notification_key AS notificationKey FROM notification_reads
     WHERE user_id = ? AND notification_key IN (SELECT value FROM json_each(?))`,
    userId,
    JSON.stringify(candidates.flatMap(({ storedKeys }) => storedKeys)),
  ).map((row) => row.notificationKey));
  return new Set(candidates.filter(({ storedKeys }) => storedKeys.some((key) => readKeys.has(key))).map(({ key }) => key));
}
