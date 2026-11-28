import "server-only";

import { one } from "./db";

const activeAssignmentAccount = "FROM users WHERE id = ? AND is_active = 1";

export function hasActiveAssignmentAccount(userId: number): boolean {
  return one(`SELECT id ${activeAssignmentAccount}`, userId) !== undefined;
}

export function getActiveAssignmentAccount(userId: number) {
  return one<{ id: number; name: string }>(`SELECT id, name ${activeAssignmentAccount}`, userId);
}
