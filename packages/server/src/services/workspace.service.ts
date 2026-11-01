import { newId } from "@remoteforge/shared";
import type { Workspace } from "@remoteforge/shared";

// Use a local type alias to avoid node:sqlite import issues in vitest
type Db = any;

export class WorkspaceService {
  constructor(private db: Db) {}

  create(input: { nodeId: string; name: string; metadata?: Record<string, unknown> }): Workspace {
    const id = newId("ws");
    const now = Date.now();
    this.db
      .prepare("INSERT INTO workspaces (id, node_id, name, path, status, created_at, destroyed_at, metadata) VALUES (?,?,?,?,?,?,?,?)")
      .run(id, input.nodeId, input.name, null, "pending", now, null, JSON.stringify(input.metadata ?? {}));
    return this.get(id)!;
  }

  get(id: string): Workspace | null {
    const row = this.db.prepare("SELECT id, node_id, name, path, status, created_at, destroyed_at, metadata FROM workspaces WHERE id = ?").get(id) as any;
    if (!row) return null;
    return this.row(row);
  }

  list(filter?: { nodeId?: string; status?: string }): Workspace[] {
    let sql = "SELECT id, node_id, name, path, status, created_at, destroyed_at, metadata FROM workspaces";
    const params: any[] = [];
    const conds: string[] = [];
    if (filter?.nodeId) { conds.push("node_id = ?"); params.push(filter.nodeId); }
    if (filter?.status) { conds.push("status = ?"); params.push(filter.status); }
    if (conds.length) sql += " WHERE " + conds.join(" AND ");
    sql += " ORDER BY created_at DESC";
    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((r) => this.row(r));
  }

  setPath(id: string, p: string): void {
    this.db.prepare("UPDATE workspaces SET path = ? WHERE id = ?").run(p, id);
  }

  setStatus(id: string, status: Workspace["status"]): void {
    this.db.prepare("UPDATE workspaces SET status = ? WHERE id = ?").run(status, id);
  }

  markDestroyed(id: string): void {
    const now = Date.now();
    this.db.prepare("UPDATE workspaces SET status = 'destroyed', destroyed_at = ? WHERE id = ?").run(now, id);
  }

  private row(r: any): Workspace {
    return {
      id: r.id,
      nodeId: r.node_id,
      name: r.name,
      path: r.path,
      status: r.status,
      createdAt: r.created_at,
      destroyedAt: r.destroyed_at,
      metadata: JSON.parse(r.metadata || "{}"),
    };
  }
}