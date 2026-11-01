import type { DatabaseSync as Database } from "node:sqlite";
import { newId, generateToken, hashToken, safeEqualHex } from "@remoteforge/shared";
import type { SessionRequest, Scope } from "@remoteforge/shared";

export const SESSION_REQUEST_TTL_MS = 10 * 60 * 1000; // 10 min
export const SESSION_CREDENTIAL_TTL_MS = 60 * 60 * 1000; // 1 h default

export class SessionService {
  constructor(private db: Database) {}

  create(input: {
    agentIdentity: string;
    projectName?: string | null;
    requestedScopes: Scope[];
    nodeId?: string | null;
    metadata?: Record<string, unknown>;
  }): { session: SessionRequest; sessionSecret: string } {
    const now = Date.now();
    const id = newId("ses");
    const expiresAt = now + SESSION_REQUEST_TTL_MS;
    const sessionSecret = generateToken();
    const meta = { ...(input.metadata ?? {}), sessionSecretHash: hashToken(sessionSecret) };
    this.db
      .prepare(
        "INSERT INTO sessions (id, agent_identity, project_name, requested_scopes, approved_scopes, node_id, status, created_at, expires_at, approved_at, approved_by, credential_id, metadata) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        input.agentIdentity,
        input.projectName ?? null,
        JSON.stringify(input.requestedScopes),
        null,
        input.nodeId ?? null,
        "pending",
        now,
        expiresAt,
        null,
        null,
        null,
        JSON.stringify(meta),
      );
    return { session: this.get(id)!, sessionSecret };
  }

  get(id: string): SessionRequest | null {
    const row = this.db
      .prepare(
        "SELECT id, agent_identity, project_name, requested_scopes, approved_scopes, node_id, status, created_at, expires_at, approved_at, approved_by, credential_id, metadata FROM sessions WHERE id = ?",
      )
      .get(id) as any;
    if (!row) return null;
    return this.rowToSession(row);
  }

  list(filter?: { status?: string }): SessionRequest[] {
    const now = Date.now();
    this.db
      .prepare("UPDATE sessions SET status = 'expired' WHERE status = 'pending' AND expires_at < ?")
      .run(now);
    let sql =
      "SELECT id, agent_identity, project_name, requested_scopes, approved_scopes, node_id, status, created_at, expires_at, approved_at, approved_by, credential_id, metadata FROM sessions";
    const params: any[] = [];
    if (filter?.status) {
      sql += " WHERE status = ?";
      params.push(filter.status);
    }
    sql += " ORDER BY created_at DESC";
    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((r) => this.rowToSession(r));
  }

  approve(sessionId: string, approvedBy: string, approvedScopes: Scope[], ttlMs?: number): { session: SessionRequest } {
    const s = this.get(sessionId);
    if (!s) throw new Error("NOT_FOUND");
    if (s.status !== "pending") throw new Error("INVALID_STATUS");
    if (s.expiresAt < Date.now()) {
      this.expire(sessionId);
      throw new Error("EXPIRED");
    }
    for (const sc of approvedScopes) {
      if (!s.requestedScopes.includes(sc)) throw new Error("SCOPE_NOT_REQUESTED");
    }
    const now = Date.now();
    this.db
      .prepare(
        "UPDATE sessions SET status = 'approved', approved_scopes = ?, approved_at = ?, approved_by = ? WHERE id = ?",
      )
      .run(JSON.stringify(approvedScopes), now, approvedBy, sessionId);
    return { session: this.get(sessionId)! };
  }

  claim(sessionId: string, sessionSecret: string, ttlMs?: number): { session: SessionRequest; token: string } {
    const s = this.get(sessionId);
    if (!s) throw new Error("NOT_FOUND");
    if (s.expiresAt < Date.now()) {
      this.expire(sessionId);
      throw new Error("EXPIRED");
    }
    // read metadata from db
    const row = this.db.prepare("SELECT metadata FROM sessions WHERE id = ?").get(sessionId) as any;
    const meta = JSON.parse(row?.metadata || "{}");
    if (!meta.sessionSecretHash || !safeEqualHex(meta.sessionSecretHash, hashToken(sessionSecret))) {
      throw new Error("INVALID_SECRET");
    }
    if (s.status !== "approved") {
      if (s.status === "active") throw new Error("ALREADY_CLAIMED");
      throw new Error("NOT_APPROVED");
    }
    const approvedScopes = (s.approvedScopes ?? s.requestedScopes) as Scope[];
    const now = Date.now();
    const ttl = ttlMs && ttlMs > 0 ? Math.min(ttlMs, 24 * 60 * 60 * 1000) : SESSION_CREDENTIAL_TTL_MS;
    const expiresAt = now + ttl;
    const token = generateToken();
    const credId = newId("cred");
    this.db
      .prepare(
        "INSERT INTO credentials (id, kind, token_hash, owner_id, scopes, created_at, expires_at, revoked_at, last_used_at) VALUES (?,?,?,?,?,?,?,?,?)",
      )
      .run(credId, "session", hashToken(token), sessionId, JSON.stringify(approvedScopes), now, expiresAt, null, null);
    this.db
      .prepare("UPDATE sessions SET status = 'active', credential_id = ? WHERE id = ?")
      .run(credId, sessionId);
    return { session: this.get(sessionId)!, token };
  }

  reject(sessionId: string, approvedBy: string): void {
    const s = this.get(sessionId);
    if (!s) throw new Error("NOT_FOUND");
    if (s.status !== "pending") throw new Error("INVALID_STATUS");
    const now = Date.now();
    this.db
      .prepare("UPDATE sessions SET status = 'rejected', approved_at = ?, approved_by = ? WHERE id = ?")
      .run(now, approvedBy, sessionId);
  }

  revoke(sessionId: string): boolean {
    const s = this.get(sessionId);
    if (!s) return false;
    const now = Date.now();
    this.db.prepare("UPDATE sessions SET status = 'revoked' WHERE id = ?").run(sessionId);
    if (s.credentialId) {
      this.db.prepare("UPDATE credentials SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(now, s.credentialId);
    }
    return true;
  }

  expire(sessionId: string): void {
    this.db.prepare("UPDATE sessions SET status = 'expired' WHERE id = ? AND status = 'pending'").run(sessionId);
  }

  /** Resolve a session credential token to scopes + session id. */
  resolveSessionToken(token: string): { sessionId: string; scopes: Scope[]; nodeId: string | null } | null {
    const hash = hashToken(token);
    const row = this.db
      .prepare(
        "SELECT c.id, c.owner_id, c.scopes, c.revoked_at, c.expires_at, s.node_id, s.status FROM credentials c JOIN sessions s ON s.id = c.owner_id WHERE c.token_hash = ? AND c.kind = 'session'",
      )
      .get(hash) as any;
    if (!row) return null;
    if (row.revoked_at) return null;
    if (row.expires_at && row.expires_at < Date.now()) return null;
    if (row.status !== "active") return null;
    const now = Date.now();
    this.db.prepare("UPDATE credentials SET last_used_at = ? WHERE id = ?").run(now, row.id);
    return {
      sessionId: row.owner_id,
      scopes: JSON.parse(row.scopes),
      nodeId: row.node_id,
    };
  }

  private rowToSession(row: any): SessionRequest {
    return {
      id: row.id,
      agentIdentity: row.agent_identity,
      projectName: row.project_name,
      requestedScopes: JSON.parse(row.requested_scopes),
      approvedScopes: row.approved_scopes ? JSON.parse(row.approved_scopes) : null,
      nodeId: row.node_id,
      status: row.status,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      approvedAt: row.approved_at,
      approvedBy: row.approved_by,
      credentialId: row.credential_id,
    };
  }
}
