import type { DatabaseSync as Database } from "node:sqlite";
import {
  newId,
  generatePairingCode,
  hashToken,
  generateToken,
  safeEqualHex,
} from "@remoteforge/shared";
import type { PairingRequest, VpsNode } from "@remoteforge/shared";

export const PAIRING_TTL_MS = 10 * 60 * 1000; // 10 min

export class PairingService {
  constructor(private db: Database) {}

  /** Agent initiates pairing. Creates a pending node + pairing request. */
  initiate(input: {
    name: string;
    hostname?: string;
    os?: string;
    arch?: string;
    agentVersion?: string;
    metadata?: Record<string, unknown>;
  }): { pairingId: string; code: string; expiresAt: number; nodeId: string; pairingSecret: string } {
    const now = Date.now();
    const nodeId = newId("node");
    this.db
      .prepare(
        "INSERT INTO vps_nodes (id, name, hostname, os, arch, agent_version, status, created_at, last_heartbeat_at, revoked_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      )
      .run(nodeId, input.name, input.hostname ?? null, input.os ?? null, input.arch ?? null, input.agentVersion ?? null, "pending", now, null, null);

    const pairingId = newId("pair");
    const code = generatePairingCode();
    const expiresAt = now + PAIRING_TTL_MS;
    const pairingSecret = generateToken();
    const meta = { ...(input.metadata ?? {}), pairingSecretHash: hashToken(pairingSecret) };
    this.db
      .prepare(
        "INSERT INTO pairing_requests (id, node_id, code, status, metadata, created_at, expires_at, approved_at, approved_by) VALUES (?,?,?,?,?,?,?,?,?)",
      )
      .run(pairingId, nodeId, code, "pending", JSON.stringify(meta), now, expiresAt, null, null);

    return { pairingId, code, expiresAt, nodeId, pairingSecret };
  }

  get(pairingId: string): PairingRequest | null {
    const row = this.db
      .prepare(
        "SELECT id, node_id, code, status, metadata, created_at, expires_at, approved_at, approved_by FROM pairing_requests WHERE id = ?",
      )
      .get(pairingId) as any;
    if (!row) return null;
    return this.rowToPairing(row);
  }

  /** Find a pending, non-expired pairing by code. */
  findByCode(code: string): PairingRequest | null {
    const row = this.db
      .prepare(
        "SELECT id, node_id, code, status, metadata, created_at, expires_at, approved_at, approved_by FROM pairing_requests WHERE code = ?",
      )
      .get(code) as any;
    if (!row) return null;
    const pr = this.rowToPairing(row);
    if (pr.status !== "pending") return pr;
    if (pr.expiresAt < Date.now()) {
      this.expire(pr.id);
      pr.status = "expired";
    }
    return pr;
  }

  listPending(): PairingRequest[] {
    const now = Date.now();
    // expire stale
    this.db
      .prepare("UPDATE pairing_requests SET status = 'expired' WHERE status = 'pending' AND expires_at < ?")
      .run(now);
    const rows = this.db
      .prepare(
        "SELECT id, node_id, code, status, metadata, created_at, expires_at, approved_at, approved_by FROM pairing_requests WHERE status = 'pending' ORDER BY created_at DESC",
      )
      .all() as any[];
    return rows.map((r) => this.rowToPairing(r));
  }

  approve(pairingId: string, approvedBy: string): { node: VpsNode } {
    const pr = this.get(pairingId);
    if (!pr) throw new Error("NOT_FOUND");
    if (pr.status !== "pending") throw new Error("INVALID_STATUS");
    if (pr.expiresAt < Date.now()) {
      this.expire(pairingId);
      throw new Error("EXPIRED");
    }
    const now = Date.now();
    this.db
      .prepare("UPDATE pairing_requests SET status = 'approved', approved_at = ?, approved_by = ? WHERE id = ?")
      .run(now, approvedBy, pairingId);
    const node = this.getNode(pr.nodeId!);
    if (node) {
      this.db.prepare("UPDATE vps_nodes SET status = 'paired' WHERE id = ?").run(pr.nodeId);
    }
    return { node: this.getNode(pr.nodeId!)! };
  }

  /** Agent claims an approved pairing, receiving its node credential. Single-use. */
  claim(pairingId: string, pairingSecret: string): { node: VpsNode; nodeToken: string } {
    const pr = this.get(pairingId);
    if (!pr) throw new Error("NOT_FOUND");
    if (pr.expiresAt < Date.now()) {
      this.expire(pairingId);
      throw new Error("EXPIRED");
    }
    const storedHash = (pr.metadata as any)?.pairingSecretHash;
    if (!storedHash || !safeEqualHex(storedHash, hashToken(pairingSecret))) {
      throw new Error("INVALID_SECRET");
    }
    if (pr.status !== "approved") {
      if (pr.status === "consumed") throw new Error("ALREADY_CLAIMED");
      throw new Error("NOT_APPROVED");
    }
    const now = Date.now();
    const token = generateToken();
    const credId = newId("cred");
    this.db
      .prepare(
        "INSERT INTO credentials (id, kind, token_hash, owner_id, scopes, created_at, expires_at, revoked_at, last_used_at) VALUES (?,?,?,?,?,?,?,?,?)",
      )
      .run(credId, "node", hashToken(token), pr.nodeId, JSON.stringify([]), now, null, null, null);
    this.db
      .prepare("UPDATE pairing_requests SET status = 'consumed' WHERE id = ?")
      .run(pairingId);
    const node = this.getNode(pr.nodeId!)!;
    return { node, nodeToken: token };
  }

  reject(pairingId: string, approvedBy: string): void {
    const pr = this.get(pairingId);
    if (!pr) throw new Error("NOT_FOUND");
    if (pr.status !== "pending") throw new Error("INVALID_STATUS");
    const now = Date.now();
    this.db
      .prepare("UPDATE pairing_requests SET status = 'rejected', approved_at = ?, approved_by = ? WHERE id = ?")
      .run(now, approvedBy, pairingId);
    if (pr.nodeId) {
      this.db.prepare("UPDATE vps_nodes SET status = 'revoked' WHERE id = ?").run(pr.nodeId);
    }
  }

  expire(pairingId: string): void {
    this.db.prepare("UPDATE pairing_requests SET status = 'expired' WHERE id = ? AND status = 'pending'").run(pairingId);
  }

  getNode(nodeId: string): VpsNode | null {
    const row = this.db
      .prepare(
        "SELECT id, name, hostname, os, arch, agent_version, status, created_at, last_heartbeat_at, revoked_at FROM vps_nodes WHERE id = ?",
      )
      .get(nodeId) as any;
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      hostname: row.hostname,
      os: row.os,
      arch: row.arch,
      agentVersion: row.agent_version,
      status: row.status,
      createdAt: row.created_at,
      lastHeartbeatAt: row.last_heartbeat_at,
      revokedAt: row.revoked_at,
    };
  }

  listNodes(): VpsNode[] {
    const rows = this.db
      .prepare(
        "SELECT id, name, hostname, os, arch, agent_version, status, created_at, last_heartbeat_at, revoked_at FROM vps_nodes ORDER BY created_at DESC",
      )
      .all() as any[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      hostname: row.hostname,
      os: row.os,
      arch: row.arch,
      agentVersion: row.agent_version,
      status: row.status,
      createdAt: row.created_at,
      lastHeartbeatAt: row.last_heartbeat_at,
      revokedAt: row.revoked_at,
    }));
  }

  revokeNode(nodeId: string): boolean {
    const now = Date.now();
    const info = this.db.prepare("UPDATE vps_nodes SET status = 'revoked', revoked_at = ? WHERE id = ?").run(now, nodeId);
    // revoke all node credentials
    this.db.prepare("UPDATE credentials SET revoked_at = ? WHERE owner_id = ? AND kind = 'node' AND revoked_at IS NULL").run(now, nodeId);
    return info.changes > 0;
  }

  resolveNodeToken(token: string): { kind: "node"; nodeId: string } | null {
    const hash = hashToken(token);
    const row = this.db
      .prepare("SELECT owner_id, revoked_at, expires_at FROM credentials WHERE token_hash = ? AND kind = 'node'")
      .get(hash) as any;
    if (!row || row.revoked_at) return null;
    if (row.expires_at && row.expires_at < Date.now()) return null;
    if (!row.owner_id) return null;
    // ensure node not revoked
    const node = this.getNode(row.owner_id);
    if (!node || node.status === "revoked") return null;
    this.db.prepare("UPDATE credentials SET last_used_at = ? WHERE token_hash = ?").run(Date.now(), hash);
    return { kind: "node", nodeId: row.owner_id };
  }

  recordHeartbeat(nodeId: string, token: string): boolean {
    // verify node credential
    const hash = hashToken(token);
    const row = this.db
      .prepare("SELECT id, revoked_at, expires_at FROM credentials WHERE token_hash = ? AND owner_id = ? AND kind = 'node'")
      .get(hash, nodeId) as any;
    if (!row || row.revoked_at) return false;
    if (row.expires_at && row.expires_at < Date.now()) return false;
    const now = Date.now();
    this.db.prepare("UPDATE vps_nodes SET status = 'online', last_heartbeat_at = ? WHERE id = ? AND status != 'revoked'").run(now, nodeId);
    this.db.prepare("UPDATE credentials SET last_used_at = ? WHERE id = ?").run(now, row.id);
    return true;
  }

  private rowToPairing(row: any): PairingRequest {
    return {
      id: row.id,
      nodeId: row.node_id,
      code: row.code,
      status: row.status,
      metadata: JSON.parse(row.metadata || "{}"),
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      approvedAt: row.approved_at,
      approvedBy: row.approved_by,
    };
  }
}
