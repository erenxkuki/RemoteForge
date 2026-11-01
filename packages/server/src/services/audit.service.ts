import type { DatabaseSync as Database } from "node:sqlite";
import { newId } from "@remoteforge/shared";
import type { AuditEvent } from "@remoteforge/shared";

export class AuditService {
  constructor(private db: Database) {}

  log(input: {
    actorType: AuditEvent["actorType"];
    actorId?: string | null;
    action: string;
    targetType?: string | null;
    targetId?: string | null;
    metadata?: Record<string, unknown>;
  }): AuditEvent {
    const id = newId("aud");
    const now = Date.now();
    this.db
      .prepare(
        "INSERT INTO audit_events (id, actor_type, actor_id, action, target_type, target_id, metadata, created_at) VALUES (?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        input.actorType,
        input.actorId ?? null,
        input.action,
        input.targetType ?? null,
        input.targetId ?? null,
        JSON.stringify(input.metadata ?? {}),
        now,
      );
    return {
      id,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      metadata: input.metadata ?? {},
      createdAt: now,
    };
  }

  list(limit = 50, offset = 0): AuditEvent[] {
    const rows = this.db
      .prepare(
        "SELECT id, actor_type, actor_id, action, target_type, target_id, metadata, created_at FROM audit_events ORDER BY created_at DESC LIMIT ? OFFSET ?",
      )
      .all(limit, offset) as any[];
    return rows.map((r) => ({
      id: r.id,
      actorType: r.actor_type,
      actorId: r.actor_id,
      action: r.action,
      targetType: r.target_type,
      targetId: r.target_id,
      metadata: JSON.parse(r.metadata || "{}"),
      createdAt: r.created_at,
    }));
  }
}
