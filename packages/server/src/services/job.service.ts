import { newId } from "@remoteforge/shared";
import type { Job, JobStatus } from "@remoteforge/shared";

type Db = any;

export class JobService {
  constructor(private db: Db) {}

  create(input: {
    nodeId: string;
    workspaceId?: string | null;
    type: string;
    payload?: Record<string, unknown>;
    timeoutMs?: number | null;
    requestedBy?: string | null;
  }): Job {
    const id = newId("job");
    const now = Date.now();
    this.db
      .prepare(
        "INSERT INTO jobs (id, node_id, workspace_id, type, payload, status, result, logs, exit_code, created_at, started_at, finished_at, timeout_ms, requested_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        input.nodeId,
        input.workspaceId ?? null,
        input.type,
        JSON.stringify(input.payload ?? {}),
        "pending",
        null,
        "",
        null,
        now,
        null,
        null,
        input.timeoutMs ?? null,
        input.requestedBy ?? null,
      );
    return this.get(id)!;
  }

  get(id: string): Job | null {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as any;
    if (!row) return null;
    return this.row(row);
  }

  list(filter?: { nodeId?: string; status?: string; workspaceId?: string }): Job[] {
    let sql = "SELECT * FROM jobs";
    const params: any[] = [];
    const conds: string[] = [];
    if (filter?.nodeId) { conds.push("node_id = ?"); params.push(filter.nodeId); }
    if (filter?.status) { conds.push("status = ?"); params.push(filter.status); }
    if (filter?.workspaceId) { conds.push("workspace_id = ?"); params.push(filter.workspaceId); }
    if (conds.length) sql += " WHERE " + conds.join(" AND ");
    sql += " ORDER BY created_at DESC";
    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((r) => this.row(r));
  }

  /** Agent claims next pending job for a node. */
  claimNext(nodeId: string): Job | null {
    const row = this.db
      .prepare("SELECT id FROM jobs WHERE node_id = ? AND status = 'pending' ORDER BY created_at ASC LIMIT 1")
      .get(nodeId) as any;
    if (!row) return null;
    const now = Date.now();
    const info = this.db
      .prepare("UPDATE jobs SET status = 'running', started_at = ? WHERE id = ? AND status = 'pending'")
      .run(now, row.id);
    if (info.changes === 0) return null;
    return this.get(row.id);
  }

  appendLog(id: string, chunk: string): void {
    this.db.prepare("UPDATE jobs SET logs = logs || ? WHERE id = ?").run(chunk, id);
  }

  finish(id: string, status: JobStatus, result?: Record<string, unknown> | null, exitCode?: number | null, logs?: string): void {
    const now = Date.now();
    if (logs !== undefined) {
      this.db.prepare("UPDATE jobs SET status = ?, result = ?, exit_code = ?, finished_at = ?, logs = ? WHERE id = ?")
        .run(status, result ? JSON.stringify(result) : null, exitCode ?? null, now, logs, id);
    } else {
      this.db.prepare("UPDATE jobs SET status = ?, result = ?, exit_code = ?, finished_at = ? WHERE id = ?")
        .run(status, result ? JSON.stringify(result) : null, exitCode ?? null, now, id);
    }
  }

  cancel(id: string): boolean {
    const info = this.db.prepare("UPDATE jobs SET status = 'cancelled', finished_at = ? WHERE id = ? AND status IN ('pending','running')").run(Date.now(), id);
    return info.changes > 0;
  }

  private row(r: any): Job {
    return {
      id: r.id,
      nodeId: r.node_id,
      workspaceId: r.workspace_id,
      type: r.type,
      payload: JSON.parse(r.payload || "{}"),
      status: r.status,
      result: r.result ? JSON.parse(r.result) : null,
      logs: r.logs || "",
      exitCode: r.exit_code,
      createdAt: r.created_at,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      timeoutMs: r.timeout_ms,
      requestedBy: r.requested_by,
    };
  }
}