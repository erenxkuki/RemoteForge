import type { DatabaseSync as Database } from "node:sqlite";
import { newId, hashPassword, verifyPassword, generateToken, hashToken } from "@remoteforge/shared";
import type { User, Credential } from "@remoteforge/shared";

export interface AuthContext {
  userId: string;
  username: string;
}

const ADMIN_SCOPES = [] as const;

export class AuthService {
  constructor(private db: Database) {}

  hasAnyUser(): boolean {
    const row = this.db.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number };
    return row.c > 0;
  }

  bootstrapAdmin(username: string, password: string): { user: User; token: string } {
    if (this.hasAnyUser()) {
      throw new Error("ALREADY_BOOTSTRAPPED");
    }
    const id = newId("usr");
    const now = Date.now();
    const passwordHash = hashPassword(password);
    this.db
      .prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?,?,?,?)")
      .run(id, username, passwordHash, now);
    // issue admin credential (no expiry by default but revocable)
    const token = generateToken();
    const credId = newId("cred");
    this.db
      .prepare(
        "INSERT INTO credentials (id, kind, token_hash, owner_id, scopes, created_at, expires_at, revoked_at, last_used_at) VALUES (?,?,?,?,?,?,?,?,?)",
      )
      .run(credId, "admin", hashToken(token), id, JSON.stringify([]), now, null, null, null);
    const user: User = { id, username, passwordHash, createdAt: now };
    return { user, token };
  }

  login(username: string, password: string): { user: User; token: string } | null {
    const row = this.db
      .prepare("SELECT id, username, password_hash, created_at FROM users WHERE username = ?")
      .get(username) as
      | { id: string; username: string; password_hash: string; created_at: number }
      | undefined;
    if (!row) return null;
    if (!verifyPassword(password, row.password_hash)) return null;
    const token = generateToken();
    const credId = newId("cred");
    const now = Date.now();
    this.db
      .prepare(
        "INSERT INTO credentials (id, kind, token_hash, owner_id, scopes, created_at, expires_at, revoked_at, last_used_at) VALUES (?,?,?,?,?,?,?,?,?)",
      )
      .run(credId, "admin", hashToken(token), row.id, JSON.stringify([]), now, null, null, null);
    const user: User = {
      id: row.id,
      username: row.username,
      passwordHash: row.password_hash,
      createdAt: row.created_at,
    };
    return { user, token };
  }

  /** Resolve a bearer token to an auth context (admin only for Phase 1). */
  resolveToken(token: string): AuthContext | null {
    const hash = hashToken(token);
    const row = this.db
      .prepare(
        "SELECT c.id, c.owner_id, c.revoked_at, c.expires_at, u.username FROM credentials c LEFT JOIN users u ON u.id = c.owner_id WHERE c.token_hash = ? AND c.kind = 'admin'",
      )
      .get(hash) as
      | { id: string; owner_id: string | null; revoked_at: number | null; expires_at: number | null; username: string | null }
      | undefined;
    if (!row) return null;
    if (row.revoked_at) return null;
    if (row.expires_at && row.expires_at < Date.now()) return null;
    if (!row.owner_id) return null;
    // update last used
    this.db.prepare("UPDATE credentials SET last_used_at = ? WHERE id = ?").run(Date.now(), row.id);
    return { userId: row.owner_id, username: row.username ?? "" };
  }

  revokeCredentialByHash(token: string): boolean {
    const hash = hashToken(token);
    const info = this.db
      .prepare("UPDATE credentials SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL")
      .run(Date.now(), hash);
    return info.changes > 0;
  }
}
