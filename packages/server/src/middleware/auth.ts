import type { FastifyRequest, FastifyReply } from "fastify";
import type { AuthService } from "../services/auth.service.js";
import type { PairingService } from "../services/pairing.service.js";
import type { SessionService } from "../services/session.service.js";

export interface AdminAuth {
  kind: "admin";
  userId: string;
  username: string;
}

export interface NodeAuth {
  kind: "node";
  nodeId: string;
}

export interface SessionAuth {
  kind: "session";
  sessionId: string;
  scopes: string[];
  nodeId: string | null;
}

export type AuthContext = AdminAuth | NodeAuth | SessionAuth;

export function extractBearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

export function makeAuthMiddleware(deps: {
  auth: AuthService;
  pairing: PairingService;
  session: SessionService;
}) {
  return async function authenticate(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const token = extractBearer(req);
    if (!token) {
      reply.code(401).send({ code: "UNAUTHORIZED", message: "Missing bearer token" });
      throw new Error("UNAUTHORIZED");
    }
    // try admin
    const admin = deps.auth.resolveToken(token);
    if (admin) {
      (req as any).auth = { kind: "admin", userId: admin.userId, username: admin.username } as AdminAuth;
      return;
    }
    // try node: find node by credential hash
    // We need a node resolver; pairing service has recordHeartbeat but not resolve. Add inline lookup via db? Use pairing service helper.
    const nodeAuth = deps.pairing.resolveNodeToken?.(token);
    if (nodeAuth) {
      (req as any).auth = nodeAuth;
      return;
    }
    const sessionAuth = deps.session.resolveSessionToken(token);
    if (sessionAuth) {
      (req as any).auth = {
        kind: "session",
        sessionId: sessionAuth.sessionId,
        scopes: sessionAuth.scopes,
        nodeId: sessionAuth.nodeId,
      } as SessionAuth;
      return;
    }
    reply.code(401).send({ code: "UNAUTHORIZED", message: "Invalid or expired token" });
    throw new Error("UNAUTHORIZED");
  };
}

export function requireAdmin(req: FastifyRequest, reply: FastifyReply): void {
  const a = (req as any).auth as AuthContext | undefined;
  if (!a || a.kind !== "admin") {
    reply.code(403).send({ code: "FORBIDDEN", message: "Admin required" });
    throw new Error("FORBIDDEN");
  }
}

export function requireScope(req: FastifyRequest, reply: FastifyReply, scope: string): void {
  const a = (req as any).auth as AuthContext | undefined;
  if (!a) {
    reply.code(401).send({ code: "UNAUTHORIZED", message: "Unauthenticated" });
    throw new Error("UNAUTHORIZED");
  }
  if (a.kind === "admin") return; // admin has all
  if (a.kind === "session" && a.scopes.includes(scope)) return;
  reply.code(403).send({ code: "FORBIDDEN", message: `Missing scope: ${scope}` });
  throw new Error("FORBIDDEN");
}