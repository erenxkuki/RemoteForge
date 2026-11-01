import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { DatabaseSync as Database } from "node:sqlite";
import { openDatabase } from "./db/database.js";
import { AuthService } from "./services/auth.service.js";
import { PairingService } from "./services/pairing.service.js";
import { SessionService } from "./services/session.service.js";
import { AuditService } from "./services/audit.service.js";
import { WorkspaceService } from "./services/workspace.service.js";
import { JobService } from "./services/job.service.js";
import { TerminalService } from "./services/terminal.service.js";
import { newId } from "@remoteforge/shared";
import { createRateLimiter } from "./middleware/rateLimit.js";
import { makeAuthMiddleware } from "./middleware/auth.js";

export interface AppContext {
  db: Database;
  auth: AuthService;
  pairing: PairingService;
  session: SessionService;
  audit: AuditService;
  workspace: WorkspaceService;
  job: JobService;
  terminal: TerminalService;
}

export interface BuildAppOptions {
  dbPath?: string;
  logger?: boolean;
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance & { ctx: AppContext }> {
  const db = openDatabase({ path: opts.dbPath ?? ":memory:" });
  const auth = new AuthService(db);
  const pairing = new PairingService(db);
  const session = new SessionService(db);
  const audit = new AuditService(db);
  const workspace = new WorkspaceService(db);
  const job = new JobService(db);

  const app = Fastify({ logger: opts.logger ?? false }) as unknown as FastifyInstance & { ctx: AppContext };
  // terminal service attaches websocket server to app.server
  const terminal = new TerminalService(app, db);
  const ctx: AppContext = { db, auth, pairing, session, audit, workspace, job, terminal };
  app.ctx = ctx;

  await app.register(cors, { origin: true, credentials: true });

  // rate limit global (generous)
  const globalLimiter = createRateLimiter({ windowMs: 60_000, max: 300 });
  app.addHook("onRequest", globalLimiter);

  const authenticate = makeAuthMiddleware({ auth, pairing, session });

  // error handler
  app.setErrorHandler((err: any, _req, reply) => {
    const status = err?.statusCode ?? 500;
    const code = err?.code ?? (status === 429 ? "RATE_LIMITED" : "INTERNAL");
    reply.code(status).send({ code, message: err?.message ?? "Internal error" });
  });

  // Health
  app.get("/health", async () => ({ ok: true, version: "0.1.0" }));

  // ---- Auth routes ----
  app.post("/api/auth/bootstrap", async (req, reply) => {
    const body = (req.body ?? {}) as any;
    // validate via zod lazily
    const { BootstrapAdminSchema } = await import("@remoteforge/shared");
    const parsed = BootstrapAdminSchema.safeParse(body);
    if (!parsed.success) {
      reply.code(400).send({ code: "VALIDATION", message: "Invalid input", details: parsed.error.flatten() });
      return;
    }
    try {
      const { user, token } = auth.bootstrapAdmin(parsed.data.username, parsed.data.password);
      audit.log({ actorType: "user", actorId: user.id, action: "admin.bootstrap", targetType: "user", targetId: user.id });
      return { userId: user.id, username: user.username, token };
    } catch (e: any) {
      if (e?.message === "ALREADY_BOOTSTRAPPED") {
        reply.code(409).send({ code: "CONFLICT", message: "Already bootstrapped" });
        return;
      }
      throw e;
    }
  });

  app.post("/api/auth/login", async (req, reply) => {
    const body = (req.body ?? {}) as any;
    const { LoginSchema } = await import("@remoteforge/shared");
    const parsed = LoginSchema.safeParse(body);
    if (!parsed.success) {
      reply.code(400).send({ code: "VALIDATION", message: "Invalid input", details: parsed.error.flatten() });
      return;
    }
    const res = auth.login(parsed.data.username, parsed.data.password);
    if (!res) {
      reply.code(401).send({ code: "UNAUTHORIZED", message: "Invalid credentials" });
      return;
    }
    audit.log({ actorType: "user", actorId: res.user.id, action: "admin.login", targetType: "user", targetId: res.user.id });
    return { userId: res.user.id, username: res.user.username, token: res.token };
  });

  app.get("/api/auth/me", { preHandler: authenticate }, async (req, reply) => {
    const a = (req as any).auth;
    if (a.kind !== "admin") {
      reply.code(403).send({ code: "FORBIDDEN", message: "Admin required" });
      return;
    }
    return { userId: a.userId, username: a.username };
  });

  // ---- Pairing routes ----
  app.post("/api/pairing/initiate", async (req, reply) => {
    const body = (req.body ?? {}) as any;
    const { PairingInitiateSchema } = await import("@remoteforge/shared");
    const parsed = PairingInitiateSchema.safeParse(body);
    if (!parsed.success) {
      reply.code(400).send({ code: "VALIDATION", message: "Invalid input", details: parsed.error.flatten() });
      return;
    }
    const d = parsed.data;
    const res = pairing.initiate({
      name: d.name,
      hostname: d.hostname,
      os: d.os,
      arch: d.arch,
      agentVersion: d.agentVersion,
      metadata: d.metadata,
    });
    audit.log({ actorType: "agent", actorId: null, action: "pairing.initiate", targetType: "pairing", targetId: res.pairingId, metadata: { name: d.name } });
    return res;
  });

  // Agent claims an approved pairing (no admin auth; uses pairing secret)
  app.post("/api/pairing/:id/claim", async (req, reply) => {
    const { id } = req.params as any;
    const secret = (req.headers["x-pairing-secret"] as string) || (req.body as any)?.pairingSecret;
    if (!secret) {
      reply.code(400).send({ code: "VALIDATION", message: "Missing pairing secret" });
      return;
    }
    try {
      const { node, nodeToken } = pairing.claim(id, secret);
      audit.log({ actorType: "agent", actorId: null, action: "pairing.claim", targetType: "node", targetId: node.id });
      return { node, nodeToken };
    } catch (e: any) {
      if (e?.message === "NOT_FOUND") { reply.code(404).send({ code: "NOT_FOUND", message: "Pairing not found" }); return; }
      if (e?.message === "EXPIRED") { reply.code(410).send({ code: "EXPIRED", message: "Pairing expired" }); return; }
      if (e?.message === "INVALID_SECRET") { reply.code(401).send({ code: "UNAUTHORIZED", message: "Invalid pairing secret" }); return; }
      if (e?.message === "NOT_APPROVED") { reply.code(409).send({ code: "CONFLICT", message: "Pairing not yet approved" }); return; }
      if (e?.message === "ALREADY_CLAIMED") { reply.code(409).send({ code: "CONFLICT", message: "Pairing already claimed" }); return; }
      throw e;
    }
  });

  app.get("/api/pairing/:id", { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as any;
    const pr = pairing.get(id);
    if (!pr) {
      reply.code(404).send({ code: "NOT_FOUND", message: "Pairing not found" });
      return;
    }
    return pr;
  });

  app.get("/api/pairing", { preHandler: authenticate }, async (req) => {
    // admin only enforced below
    const a = (req as any).auth;
    if (a.kind !== "admin") {
      // allow? listing pending requires admin
    }
    return { items: pairing.listPending() };
  });

  app.post("/api/pairing/:id/approve", { preHandler: authenticate }, async (req, reply) => {
    const a = (req as any).auth;
    if (a.kind !== "admin") {
      reply.code(403).send({ code: "FORBIDDEN", message: "Admin required" });
      return;
    }
    const { id } = req.params as any;
    const body = (req.body ?? {}) as any;
    try {
      const { node } = pairing.approve(id, a.userId);
      audit.log({ actorType: "user", actorId: a.userId, action: "pairing.approve", targetType: "node", targetId: node.id });
      return { node };
    } catch (e: any) {
      if (e?.message === "NOT_FOUND") { reply.code(404).send({ code: "NOT_FOUND", message: "Pairing not found" }); return; }
      if (e?.message === "INVALID_STATUS") { reply.code(409).send({ code: "CONFLICT", message: "Pairing not pending" }); return; }
      if (e?.message === "EXPIRED") { reply.code(410).send({ code: "EXPIRED", message: "Pairing expired" }); return; }
      throw e;
    }
  });

  app.post("/api/pairing/:id/reject", { preHandler: authenticate }, async (req, reply) => {
    const a = (req as any).auth;
    if (a.kind !== "admin") {
      reply.code(403).send({ code: "FORBIDDEN", message: "Admin required" });
      return;
    }
    const { id } = req.params as any;
    try {
      pairing.reject(id, a.userId);
      audit.log({ actorType: "user", actorId: a.userId, action: "pairing.reject", targetType: "pairing", targetId: id });
      return { ok: true };
    } catch (e: any) {
      if (e?.message === "NOT_FOUND") { reply.code(404).send({ code: "NOT_FOUND", message: "Pairing not found" }); return; }
      if (e?.message === "INVALID_STATUS") { reply.code(409).send({ code: "CONFLICT", message: "Pairing not pending" }); return; }
      throw e;
    }
  });

  // ---- Node routes ----
  app.get("/api/nodes", { preHandler: authenticate }, async (req, reply) => {
    const a = (req as any).auth;
    if (a.kind !== "admin") {
      reply.code(403).send({ code: "FORBIDDEN", message: "Admin required" });
      return;
    }
    return { items: pairing.listNodes() };
  });

  app.get("/api/nodes/:id", { preHandler: authenticate }, async (req, reply) => {
    const a = (req as any).auth;
    const { id } = req.params as any;
    if (a.kind !== "admin" && !(a.kind === "node" && a.nodeId === id)) {
      reply.code(403).send({ code: "FORBIDDEN", message: "Forbidden" });
      return;
    }
    const node = pairing.getNode(id);
    if (!node) {
      reply.code(404).send({ code: "NOT_FOUND", message: "Node not found" });
      return;
    }
    return node;
  });

  app.post("/api/nodes/:id/heartbeat", { preHandler: authenticate }, async (req, reply) => {
    const a = (req as any).auth;
    const { id } = req.params as any;
    if (!(a.kind === "node" && a.nodeId === id)) {
      reply.code(403).send({ code: "FORBIDDEN", message: "Node credential required for this node" });
      return;
    }
    const body = (req.body ?? {}) as any;
    const { HeartbeatSchema } = await import("@remoteforge/shared");
    const parsed = HeartbeatSchema.safeParse(body);
    if (!parsed.success) {
      reply.code(400).send({ code: "VALIDATION", message: "Invalid input", details: parsed.error.flatten() });
      return;
    }
    const token = extractBearerToken(req);
    const ok = pairing.recordHeartbeat(id, token!);
    if (!ok) {
      reply.code(401).send({ code: "UNAUTHORIZED", message: "Invalid credential" });
      return;
    }
    return { ok: true };
  });

  app.post("/api/nodes/:id/revoke", { preHandler: authenticate }, async (req, reply) => {
    const a = (req as any).auth;
    if (a.kind !== "admin") {
      reply.code(403).send({ code: "FORBIDDEN", message: "Admin required" });
      return;
    }
    const { id } = req.params as any;
    const ok = pairing.revokeNode(id);
    if (!ok) {
      reply.code(404).send({ code: "NOT_FOUND", message: "Node not found" });
      return;
    }
    audit.log({ actorType: "user", actorId: a.userId, action: "node.revoke", targetType: "node", targetId: id });
    return { ok: true };
  });

  // ---- Session routes ----
  app.post("/api/sessions/request", async (req, reply) => {
    const body = (req.body ?? {}) as any;
    const { SessionRequestSchema } = await import("@remoteforge/shared");
    const parsed = SessionRequestSchema.safeParse(body);
    if (!parsed.success) {
      reply.code(400).send({ code: "VALIDATION", message: "Invalid input", details: parsed.error.flatten() });
      return;
    }
    const d = parsed.data;
    const { session: s, sessionSecret } = session.create({
      agentIdentity: d.agentIdentity,
      projectName: d.projectName ?? null,
      requestedScopes: d.requestedScopes as any,
      nodeId: d.nodeId ?? null,
      metadata: d.metadata,
    });
    audit.log({ actorType: "agent", actorId: null, action: "session.request", targetType: "session", targetId: s.id, metadata: { agentIdentity: d.agentIdentity } });
    return { session: s, sessionSecret };
  });

  app.get("/api/sessions", { preHandler: authenticate }, async (req, reply) => {
    const a = (req as any).auth;
    if (a.kind !== "admin") {
      reply.code(403).send({ code: "FORBIDDEN", message: "Admin required" });
      return;
    }
    const q = (req.query ?? {}) as any;
    const status = q.status as string | undefined;
    return { items: session.list(status ? { status } : undefined) };
  });

  app.get("/api/sessions/:id", { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as any;
    const s = session.get(id);
    if (!s) {
      reply.code(404).send({ code: "NOT_FOUND", message: "Session not found" });
      return;
    }
    const a = (req as any).auth;
    // admin or owning session token
    if (a.kind !== "admin" && !(a.kind === "session" && a.sessionId === id)) {
      reply.code(403).send({ code: "FORBIDDEN", message: "Forbidden" });
      return;
    }
    return s;
  });

  app.post("/api/sessions/:id/approve", { preHandler: authenticate }, async (req, reply) => {
    const a = (req as any).auth;
    if (a.kind !== "admin") {
      reply.code(403).send({ code: "FORBIDDEN", message: "Admin required" });
      return;
    }
    const { id } = req.params as any;
    const body = (req.body ?? {}) as any;
    const { SessionApproveSchema } = await import("@remoteforge/shared");
    const parsed = SessionApproveSchema.safeParse(body);
    if (!parsed.success) {
      reply.code(400).send({ code: "VALIDATION", message: "Invalid input", details: parsed.error.flatten() });
      return;
    }
    try {
      const { session: s } = session.approve(id, a.userId, parsed.data.approvedScopes as any);
      audit.log({ actorType: "user", actorId: a.userId, action: "session.approve", targetType: "session", targetId: id, metadata: { scopes: parsed.data.approvedScopes } });
      return { session: s };
    } catch (e: any) {
      if (e?.message === "NOT_FOUND") { reply.code(404).send({ code: "NOT_FOUND", message: "Session not found" }); return; }
      if (e?.message === "INVALID_STATUS") { reply.code(409).send({ code: "CONFLICT", message: "Session not pending" }); return; }
      if (e?.message === "EXPIRED") { reply.code(410).send({ code: "EXPIRED", message: "Session request expired" }); return; }
      if (e?.message === "SCOPE_NOT_REQUESTED") { reply.code(400).send({ code: "VALIDATION", message: "Approved scope was not requested" }); return; }
      throw e;
    }
  });

  app.post("/api/sessions/:id/reject", { preHandler: authenticate }, async (req, reply) => {
    const a = (req as any).auth;
    if (a.kind !== "admin") {
      reply.code(403).send({ code: "FORBIDDEN", message: "Admin required" });
      return;
    }
    const { id } = req.params as any;
    try {
      session.reject(id, a.userId);
      audit.log({ actorType: "user", actorId: a.userId, action: "session.reject", targetType: "session", targetId: id });
      return { ok: true };
    } catch (e: any) {
      if (e?.message === "NOT_FOUND") { reply.code(404).send({ code: "NOT_FOUND", message: "Session not found" }); return; }
      if (e?.message === "INVALID_STATUS") { reply.code(409).send({ code: "CONFLICT", message: "Session not pending" }); return; }
      throw e;
    }
  });

  app.post("/api/sessions/:id/claim", async (req, reply) => {
    const { id } = req.params as any;
    const body = (req.body ?? {}) as any;
    const secret = body.sessionSecret || (req.headers["x-session-secret"] as string);
    if (!secret) { reply.code(400).send({ code: "VALIDATION", message: "Missing session secret" }); return; }
    try {
      const { session: s, token } = session.claim(id, secret, body.ttlMs);
      audit.log({ actorType: "agent", actorId: null, action: "session.claim", targetType: "session", targetId: id });
      return { session: s, token };
    } catch (e: any) {
      if (e?.message === "NOT_FOUND") { reply.code(404).send({ code: "NOT_FOUND", message: "Session not found" }); return; }
      if (e?.message === "EXPIRED") { reply.code(410).send({ code: "EXPIRED", message: "Session request expired" }); return; }
      if (e?.message === "INVALID_SECRET") { reply.code(401).send({ code: "UNAUTHORIZED", message: "Invalid session secret" }); return; }
      if (e?.message === "NOT_APPROVED") { reply.code(409).send({ code: "CONFLICT", message: "Session not yet approved" }); return; }
      if (e?.message === "ALREADY_CLAIMED") { reply.code(409).send({ code: "CONFLICT", message: "Session already claimed" }); return; }
      throw e;
    }
  });

  app.post("/api/sessions/:id/revoke", { preHandler: authenticate }, async (req, reply) => {
    const a = (req as any).auth;
    const { id } = req.params as any;
    if (a.kind !== "admin" && !(a.kind === "session" && a.sessionId === id)) {
      reply.code(403).send({ code: "FORBIDDEN", message: "Forbidden" });
      return;
    }
    const ok = session.revoke(id);
    if (!ok) {
      reply.code(404).send({ code: "NOT_FOUND", message: "Session not found" });
      return;
    }
    audit.log({ actorType: a.kind === "admin" ? "user" : "agent", actorId: a.kind === "admin" ? a.userId : null, action: "session.revoke", targetType: "session", targetId: id });
    return { ok: true };
  });

  // ---- Audit routes ----
  app.get("/api/audit", { preHandler: authenticate }, async (req, reply) => {
    const a = (req as any).auth;
    if (a.kind !== "admin") {
      reply.code(403).send({ code: "FORBIDDEN", message: "Admin required" });
      return;
    }
    const q = (req.query ?? {}) as any;
    const limit = q.limit ? Number(q.limit) : 50;
    const offset = q.offset ? Number(q.offset) : 0;
    return { items: audit.list(limit, offset) };
  });

  // ---- Workspace routes ----
  app.post("/api/workspaces", { preHandler: authenticate }, async (req, reply) => {
    const a = (req as any).auth;
    if (a.kind !== "admin" && a.kind !== "session") {
      reply.code(403).send({ code: "FORBIDDEN", message: "Forbidden" }); return;
    }
    const body = (req.body ?? {}) as any;
    const { CreateWorkspaceSchema } = await import("@remoteforge/shared");
    const parsed = CreateWorkspaceSchema.safeParse(body);
    if (!parsed.success) { reply.code(400).send({ code: "VALIDATION", message: "Invalid input", details: parsed.error.flatten() }); return; }
    const d = parsed.data;
    // ensure node exists
    const node = pairing.getNode(d.nodeId);
    if (!node) { reply.code(404).send({ code: "NOT_FOUND", message: "Node not found" }); return; }
    const ws = workspace.create({ nodeId: d.nodeId, name: d.name, metadata: d.metadata });
    // queue job
    const j = job.create({ nodeId: d.nodeId, workspaceId: ws.id, type: "create_workspace", payload: { name: d.name }, requestedBy: a.kind === "admin" ? a.userId : null });
    audit.log({ actorType: a.kind === "admin" ? "user" : "agent", actorId: a.kind === "admin" ? a.userId : null, action: "workspace.create", targetType: "workspace", targetId: ws.id });
    return { workspace: ws, job: j };
  });

  app.get("/api/workspaces", { preHandler: authenticate }, async (req, reply) => {
    const a = (req as any).auth;
    const q = (req.query ?? {}) as any;
    const items = workspace.list({ nodeId: q.nodeId, status: q.status });
    // non-admin session: filter by node? Phase 1: admin only list all; session limited by node
    if (a.kind === "session" && a.nodeId) {
      return { items: items.filter((w) => w.nodeId === a.nodeId) };
    }
    if (a.kind !== "admin" && a.kind !== "session") {
      reply.code(403).send({ code: "FORBIDDEN", message: "Forbidden" }); return;
    }
    return { items };
  });

  app.get("/api/workspaces/:id", { preHandler: authenticate }, async (req, reply) => {
    const ws = workspace.get((req.params as any).id);
    if (!ws) { reply.code(404).send({ code: "NOT_FOUND", message: "Workspace not found" }); return; }
    return ws;
  });

  app.delete("/api/workspaces/:id", { preHandler: authenticate }, async (req, reply) => {
    const a = (req as any).auth;
    if (a.kind !== "admin") { reply.code(403).send({ code: "FORBIDDEN", message: "Admin required" }); return; }
    const ws = workspace.get((req.params as any).id);
    if (!ws) { reply.code(404).send({ code: "NOT_FOUND", message: "Workspace not found" }); return; }
    const j = job.create({ nodeId: ws.nodeId, workspaceId: ws.id, type: "destroy_workspace", payload: {}, requestedBy: a.userId });
    workspace.setStatus(ws.id, "destroying");
    audit.log({ actorType: "user", actorId: a.userId, action: "workspace.destroy", targetType: "workspace", targetId: ws.id });
    return { workspace: ws, job: j };
  });

  // ---- Job routes ----
  app.get("/api/jobs", { preHandler: authenticate }, async (req, reply) => {
    const a = (req as any).auth;
    if (a.kind !== "admin") { reply.code(403).send({ code: "FORBIDDEN", message: "Admin required" }); return; }
    const q = (req.query ?? {}) as any;
    return { items: job.list({ nodeId: q.nodeId, status: q.status, workspaceId: q.workspaceId }) };
  });

  app.get("/api/jobs/:id", { preHandler: authenticate }, async (req, reply) => {
    const j = job.get((req.params as any).id);
    if (!j) { reply.code(404).send({ code: "NOT_FOUND", message: "Job not found" }); return; }
    return j;
  });

  app.post("/api/jobs/:id/cancel", { preHandler: authenticate }, async (req, reply) => {
    const a = (req as any).auth;
    if (a.kind !== "admin") { reply.code(403).send({ code: "FORBIDDEN", message: "Admin required" }); return; }
    const ok = job.cancel((req.params as any).id);
    if (!ok) { reply.code(409).send({ code: "CONFLICT", message: "Job not cancellable" }); return; }
    return { ok: true };
  });

  // Agent job polling + result reporting
  app.get("/api/nodes/:id/jobs/next", { preHandler: authenticate }, async (req, reply) => {
    const a = (req as any).auth;
    const id = (req.params as any).id;
    if (!(a.kind === "node" && a.nodeId === id)) { reply.code(403).send({ code: "FORBIDDEN", message: "Node credential required" }); return; }
    const j = job.claimNext(id);
    if (!j) return { job: null };
    return { job: j };
  });

  app.post("/api/jobs/:id/log", { preHandler: authenticate }, async (req, reply) => {
    const a = (req as any).auth;
    if (a.kind !== "node") { reply.code(403).send({ code: "FORBIDDEN", message: "Node credential required" }); return; }
    const body = (req.body ?? {}) as any;
    job.appendLog((req.params as any).id, String(body.chunk ?? ""));
    return { ok: true };
  });

  app.post("/api/jobs/:id/finish", { preHandler: authenticate }, async (req, reply) => {
    const a = (req as any).auth;
    if (a.kind !== "node") { reply.code(403).send({ code: "FORBIDDEN", message: "Node credential required" }); return; }
    const body = (req.body ?? {}) as any;
    const status = body.status === "succeeded" ? "succeeded" : body.status === "timeout" ? "timeout" : "failed";
    job.finish((req.params as any).id, status as any, body.result ?? null, body.exitCode ?? null, body.logs);
    // update workspace status for create/destroy
    const j = job.get((req.params as any).id);
    if (j?.workspaceId) {
      if (j.type === "create_workspace" && status === "succeeded") {
        workspace.setStatus(j.workspaceId, "ready");
        if (body.result?.path) workspace.setPath(j.workspaceId, String(body.result.path));
      }
      if (j.type === "destroy_workspace" && status === "succeeded") {
        workspace.markDestroyed(j.workspaceId);
      }
    }
    return { ok: true };
  });

  // ---- File operation routes (queue jobs) ----
  app.post("/api/workspaces/:id/files/list", { preHandler: authenticate }, async (req, reply) => {
    const a = (req as any).auth;
    if (a.kind !== "admin" && a.kind !== "session") { reply.code(403).send({ code: "FORBIDDEN", message: "Forbidden" }); return; }
    const ws = workspace.get((req.params as any).id);
    if (!ws) { reply.code(404).send({ code: "NOT_FOUND", message: "Workspace not found" }); return; }
    const body = (req.body ?? {}) as any;
    const { ListFilesQuerySchema } = await import("@remoteforge/shared");
    const parsed = ListFilesQuerySchema.safeParse(body);
    const p = parsed.success ? parsed.data.path : ".";
    const j = job.create({ nodeId: ws.nodeId, workspaceId: ws.id, type: "list_files", payload: { path: p }, requestedBy: a.kind === "admin" ? a.userId : null });
    return { job: j };
  });

  app.post("/api/workspaces/:id/files/read", { preHandler: authenticate }, async (req, reply) => {
    const a = (req as any).auth;
    if (a.kind !== "admin" && a.kind !== "session") { reply.code(403).send({ code: "FORBIDDEN", message: "Forbidden" }); return; }
    const ws = workspace.get((req.params as any).id);
    if (!ws) { reply.code(404).send({ code: "NOT_FOUND", message: "Workspace not found" }); return; }
    const body = (req.body ?? {}) as any;
    const { ReadFileQuerySchema } = await import("@remoteforge/shared");
    const parsed = ReadFileQuerySchema.safeParse(body);
    if (!parsed.success) { reply.code(400).send({ code: "VALIDATION", message: "Invalid input" }); return; }
    const j = job.create({ nodeId: ws.nodeId, workspaceId: ws.id, type: "read_file", payload: { path: parsed.data.path }, requestedBy: a.kind === "admin" ? a.userId : null });
    return { job: j };
  });

  app.post("/api/workspaces/:id/files/write", { preHandler: authenticate }, async (req, reply) => {
    const a = (req as any).auth;
    if (a.kind !== "admin" && a.kind !== "session") { reply.code(403).send({ code: "FORBIDDEN", message: "Forbidden" }); return; }
    // scope check for session
    if (a.kind === "session" && !a.scopes.includes("workspace:write")) { reply.code(403).send({ code: "FORBIDDEN", message: "Missing scope: workspace:write" }); return; }
    const ws = workspace.get((req.params as any).id);
    if (!ws) { reply.code(404).send({ code: "NOT_FOUND", message: "Workspace not found" }); return; }
    const body = (req.body ?? {}) as any;
    const { WriteFileSchema } = await import("@remoteforge/shared");
    const parsed = WriteFileSchema.safeParse(body);
    if (!parsed.success) { reply.code(400).send({ code: "VALIDATION", message: "Invalid input", details: parsed.error.flatten() }); return; }
    const j = job.create({ nodeId: ws.nodeId, workspaceId: ws.id, type: "write_file", payload: { path: parsed.data.path, content: parsed.data.content, encoding: parsed.data.encoding }, requestedBy: a.kind === "admin" ? a.userId : null });
    return { job: j };
  });

  // ---- Command execution ----
  app.post("/api/workspaces/:id/commands", { preHandler: authenticate }, async (req, reply) => {
    const a = (req as any).auth;
    if (a.kind !== "admin" && a.kind !== "session") { reply.code(403).send({ code: "FORBIDDEN", message: "Forbidden" }); return; }
    if (a.kind === "session" && !a.scopes.includes("command:run")) { reply.code(403).send({ code: "FORBIDDEN", message: "Missing scope: command:run" }); return; }
    const ws = workspace.get((req.params as any).id);
    if (!ws) { reply.code(404).send({ code: "NOT_FOUND", message: "Workspace not found" }); return; }
    const body = (req.body ?? {}) as any;
    const { RunCommandSchema } = await import("@remoteforge/shared");
    const parsed = RunCommandSchema.safeParse(body);
    if (!parsed.success) { reply.code(400).send({ code: "VALIDATION", message: "Invalid input", details: parsed.error.flatten() }); return; }
    const j = job.create({ nodeId: ws.nodeId, workspaceId: ws.id, type: "run_command", payload: parsed.data, timeoutMs: parsed.data.timeoutMs ?? null, requestedBy: a.kind === "admin" ? a.userId : null });
    return { job: j };
  });

  // ---- Process management ----
  app.post("/api/workspaces/:id/processes", { preHandler: authenticate }, async (req, reply) => {
    const a = (req as any).auth;
    if (a.kind !== "admin" && a.kind !== "session") { reply.code(403).send({ code: "FORBIDDEN", message: "Forbidden" }); return; }
    if (a.kind === "session" && !a.scopes.includes("process:manage")) { reply.code(403).send({ code: "FORBIDDEN", message: "Missing scope: process:manage" }); return; }
    const ws = workspace.get((req.params as any).id);
    if (!ws) { reply.code(404).send({ code: "NOT_FOUND", message: "Workspace not found" }); return; }
    const body = (req.body ?? {}) as any;
    const { StartProcessSchema } = await import("@remoteforge/shared");
    const parsed = StartProcessSchema.safeParse(body);
    if (!parsed.success) { reply.code(400).send({ code: "VALIDATION", message: "Invalid input", details: parsed.error.flatten() }); return; }
    const j = job.create({ nodeId: ws.nodeId, workspaceId: ws.id, type: "start_process", payload: parsed.data, requestedBy: a.kind === "admin" ? a.userId : null });
    return { job: j };
  });

  app.post("/api/workspaces/:id/processes/stop", { preHandler: authenticate }, async (req, reply) => {
    const a = (req as any).auth;
    if (a.kind !== "admin" && a.kind !== "session") { reply.code(403).send({ code: "FORBIDDEN", message: "Forbidden" }); return; }
    const ws = workspace.get((req.params as any).id);
    if (!ws) { reply.code(404).send({ code: "NOT_FOUND", message: "Workspace not found" }); return; }
    const body = (req.body ?? {}) as any;
    const j = job.create({ nodeId: ws.nodeId, workspaceId: ws.id, type: "stop_process", payload: { pid: body.pid }, requestedBy: a.kind === "admin" ? a.userId : null });
    return { job: j };
  });

  app.get("/api/workspaces/:id/processes", { preHandler: authenticate }, async (req, reply) => {
    // returns jobs of type start_process for workspace
    const ws = workspace.get((req.params as any).id);
    if (!ws) { reply.code(404).send({ code: "NOT_FOUND", message: "Workspace not found" }); return; }
    const jobs = job.list({ workspaceId: ws.id });
    return { items: jobs.filter((j) => j.type === "start_process" || j.type === "stop_process" || j.type === "get_process_status") };
  });

  // ---- Upload project ----
  app.post("/api/workspaces/:id/upload", { preHandler: authenticate }, async (req, reply) => {
    const a = (req as any).auth;
    if (a.kind !== "admin" && a.kind !== "session") { reply.code(403).send({ code: "FORBIDDEN", message: "Forbidden" }); return; }
    const ws = workspace.get((req.params as any).id);
    if (!ws) { reply.code(404).send({ code: "NOT_FOUND", message: "Workspace not found" }); return; }
    // expect JSON body with filename + content(base64)
    const body = (req.body ?? {}) as any;
    if (!body.filename || !body.content) { reply.code(400).send({ code: "VALIDATION", message: "filename and content required" }); return; }
    const { uploadsDir, newStoredPath, writeFileBytes } = await import("./storage/files.js");
    const dir = uploadsDir();
    const stored = newStoredPath(dir, body.filename);
    const buf = Buffer.from(body.content, "base64");
    writeFileBytes(stored, buf);
    const uploadId = newId("upl");
    const now = Date.now();
    app.ctx.db.prepare("INSERT INTO uploads (id, workspace_id, filename, stored_path, size, created_at) VALUES (?,?,?,?,?,?)")
      .run(uploadId, ws.id, body.filename, stored, buf.length, now);
    const j = job.create({ nodeId: ws.nodeId, workspaceId: ws.id, type: "upload_project", payload: { uploadId, filename: body.filename }, requestedBy: a.kind === "admin" ? a.userId : null });
    return { uploadId, job: j };
  });

  // Agent downloads uploaded file
  app.get("/api/uploads/:id", { preHandler: authenticate }, async (req, reply) => {
    const a = (req as any).auth;
    if (a.kind !== "node") { reply.code(403).send({ code: "FORBIDDEN", message: "Node credential required" }); return; }
    const row = app.ctx.db.prepare("SELECT stored_path, filename FROM uploads WHERE id = ?").get((req.params as any).id) as any;
    if (!row) { reply.code(404).send({ code: "NOT_FOUND", message: "Upload not found" }); return; }
    const { readFileBytes } = await import("./storage/files.js");
    const buf = readFileBytes(row.stored_path);
    reply.header("Content-Type", "application/octet-stream");
    reply.header("Content-Disposition", `attachment; filename="${row.filename}"`);
    return reply.send(buf);
  });

  // Agent uploads artifact
  app.post("/api/workspaces/:id/artifacts", { preHandler: authenticate }, async (req, reply) => {
    const a = (req as any).auth;
    if (a.kind !== "node") { reply.code(403).send({ code: "FORBIDDEN", message: "Node credential required" }); return; }
    const ws = workspace.get((req.params as any).id);
    if (!ws) { reply.code(404).send({ code: "NOT_FOUND", message: "Workspace not found" }); return; }
    const body = (req.body ?? {}) as any;
    if (!body.filename || !body.content) { reply.code(400).send({ code: "VALIDATION", message: "filename and content required" }); return; }
    const { artifactsDir, newStoredPath, writeFileBytes } = await import("./storage/files.js");
    const dir = artifactsDir();
    const stored = newStoredPath(dir, body.filename);
    const buf = Buffer.from(body.content, "base64");
    writeFileBytes(stored, buf);
    const artifactId = newId("art");
    const now = Date.now();
    app.ctx.db.prepare("INSERT INTO artifacts (id, workspace_id, node_id, filename, stored_path, size, created_at) VALUES (?,?,?,?,?,?,?)")
      .run(artifactId, ws.id, a.nodeId, body.filename, stored, buf.length, now);
    return { artifactId, size: buf.length };
  });

  app.get("/api/artifacts", { preHandler: authenticate }, async (req, reply) => {
    const q = (req.query ?? {}) as any;
    let sql = "SELECT id, workspace_id, node_id, filename, size, created_at FROM artifacts";
    const params: any[] = [];
    if (q.workspaceId) { sql += " WHERE workspace_id = ?"; params.push(q.workspaceId); }
    sql += " ORDER BY created_at DESC";
    const rows = app.ctx.db.prepare(sql).all(...params) as any[];
    return { items: rows.map((r: any) => ({ id: r.id, workspaceId: r.workspace_id, nodeId: r.node_id, filename: r.filename, size: r.size, createdAt: r.created_at })) };
  });

  app.get("/api/artifacts/:id/download", { preHandler: authenticate }, async (req, reply) => {
    const row = app.ctx.db.prepare("SELECT stored_path, filename FROM artifacts WHERE id = ?").get((req.params as any).id) as any;
    if (!row) { reply.code(404).send({ code: "NOT_FOUND", message: "Artifact not found" }); return; }
    const { readFileBytes } = await import("./storage/files.js");
    const buf = readFileBytes(row.stored_path);
    reply.header("Content-Type", "application/octet-stream");
    reply.header("Content-Disposition", `attachment; filename="${row.filename}"`);
    return reply.send(buf);
  });

  app.get("/api/build-profiles", { preHandler: authenticate }, async () => {
    const { DEFAULT_BUILD_PROFILES } = await import("@remoteforge/shared");
    return { items: DEFAULT_BUILD_PROFILES };
  });

  // ---- Build job ----
  app.post("/api/workspaces/:id/build", { preHandler: authenticate }, async (req, reply) => {
    const a = (req as any).auth;
    if (a.kind !== "admin" && a.kind !== "session") { reply.code(403).send({ code: "FORBIDDEN", message: "Forbidden" }); return; }
    if (a.kind === "session" && !a.scopes.includes("build:run")) { reply.code(403).send({ code: "FORBIDDEN", message: "Missing scope: build:run" }); return; }
    const ws = workspace.get((req.params as any).id);
    if (!ws) { reply.code(404).send({ code: "NOT_FOUND", message: "Workspace not found" }); return; }
    const body = (req.body ?? {}) as any;
    const { BuildSchema } = await import("@remoteforge/shared");
    const parsed = BuildSchema.safeParse(body);
    if (!parsed.success) { reply.code(400).send({ code: "VALIDATION", message: "Invalid input", details: parsed.error.flatten() }); return; }
    const j = job.create({ nodeId: ws.nodeId, workspaceId: ws.id, type: "build", payload: parsed.data, timeoutMs: parsed.data.timeoutMs ?? null, requestedBy: a.kind === "admin" ? a.userId : null });
    return { job: j };
  });

  // ---- Install deps ----
  app.post("/api/workspaces/:id/install", { preHandler: authenticate }, async (req, reply) => {
    const a = (req as any).auth;
    if (a.kind !== "admin" && a.kind !== "session") { reply.code(403).send({ code: "FORBIDDEN", message: "Forbidden" }); return; }
    if (a.kind === "session" && !a.scopes.includes("command:run")) { reply.code(403).send({ code: "FORBIDDEN", message: "Missing scope: command:run" }); return; }
    const ws = workspace.get((req.params as any).id);
    if (!ws) { reply.code(404).send({ code: "NOT_FOUND", message: "Workspace not found" }); return; }
    const body = (req.body ?? {}) as any;
    const { InstallDepsSchema } = await import("@remoteforge/shared");
    const parsed = InstallDepsSchema.safeParse(body);
    if (!parsed.success) { reply.code(400).send({ code: "VALIDATION", message: "Invalid input", details: parsed.error.flatten() }); return; }
    const j = job.create({ nodeId: ws.nodeId, workspaceId: ws.id, type: "install_dependencies", payload: parsed.data, requestedBy: a.kind === "admin" ? a.userId : null });
    return { job: j };
  });

  // ---- Terminal session creation ----
  app.post("/api/terminal/sessions", { preHandler: authenticate }, async (req, reply) => {
    const a = (req as any).auth;
    if (a.kind !== "admin" && a.kind !== "session") { reply.code(403).send({ code: "FORBIDDEN", message: "Forbidden" }); return; }
    if (a.kind === "session" && !a.scopes.includes("terminal:open")) { reply.code(403).send({ code: "FORBIDDEN", message: "Missing scope: terminal:open" }); return; }
    const body = (req.body ?? {}) as any;
    const nodeId = body.nodeId || a.nodeId;
    if (!nodeId) { reply.code(400).send({ code: "VALIDATION", message: "nodeId required" }); return; }
    const id = terminal.createSession(nodeId, body.workspaceId);
    return { sessionId: id, wsUrl: `/ws/terminal/${id}` };
  });

  app.get("/api/terminal/agents", { preHandler: authenticate }, async () => {
    return { agents: terminal.listAgents() };
  });

  return app;
}

function extractBearerToken(req: any): string | null {
  const h = req.headers?.authorization;
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}
