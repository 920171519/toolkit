import type { DatabaseSync, StatementSync } from "node:sqlite";

export function createAuditLogWriter(database: DatabaseSync) {
  let insert: StatementSync | undefined;

  return function recordAuditLog(
    actorId: number | null,
    action: string,
    entityType: string,
    entityId: number | null,
    detail: string,
    createdAt = new Date().toISOString(),
  ) {
    insert ??= database.prepare(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    insert.run(actorId, action, entityType, entityId, detail, createdAt);
  };
}
