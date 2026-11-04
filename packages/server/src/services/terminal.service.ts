import { WebSocketServer, WebSocket } from "ws";
import { newId } from "@remoteforge/shared";
import type { FastifyInstance } from "fastify";

type Db = any;

interface AgentConn { ws: WebSocket; nodeId: string; }

export class TerminalService {
  private wss: WebSocketServer;
  private agents = new Map<string, AgentConn>(); // nodeId -> conn
  private clients = new Map<string, WebSocket>(); // sessionId -> client ws
  private sessionNode = new Map<string, string>(); // sessionId -> nodeId
  private sessionWorkspace = new Map<string, string | null>();

  constructor(app: FastifyInstance, private db: Db) {
    this.wss = new WebSocketServer({ noServer: true });
    app.server.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url || "", "http://localhost");
      if (!url.pathname.startsWith("/ws")) {
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.handleConnection(ws, req).catch(() => { try { ws.close(); } catch {} });
      });
    });
  }

  private async handleConnection(ws: WebSocket, req: any) {
    const url = new URL(req.url, "http://localhost");
    const pathname = url.pathname;
    if (pathname === "/ws/agent") {
      const token = url.searchParams.get("token");
      const nodeId = url.searchParams.get("nodeId");
      // verify node token via db
      if (!token || !nodeId) { ws.close(4001, "missing"); return; }
      const { createHash } = await import("node:crypto");
      const hash = createHash("sha256").update(token).digest("hex");
      const row = this.db.prepare("SELECT id, revoked_at FROM credentials WHERE token_hash = ? AND kind = 'node' AND owner_id = ?").get(hash, nodeId) as any;
      if (!row || row.revoked_at) { ws.close(4003, "unauthorized"); return; }
      this.agents.set(nodeId, { ws, nodeId });
      ws.on("message", (data) => this.handleAgentMessage(nodeId, data));
      ws.on("close", () => this.agents.delete(nodeId));
      ws.send(JSON.stringify({ type: "hello" }));
      return;
    }
    if (pathname.startsWith("/ws/terminal/")) {
      const sessionId = pathname.split("/").pop()!;
      this.clients.set(sessionId, ws);
      ws.on("message", (data) => this.handleClientMessage(sessionId, data));
      ws.on("close", () => {
        this.clients.delete(sessionId);
        // Do NOT kill the agent-side PTY — it persists for reconnection.
        // The terminal session remains alive on the VPS.
      });
      // request open from agent if not already
      return;
    }
    ws.close(4004, "not found");
  }

  private handleAgentMessage(nodeId: string, data: any) {
    let msg: any;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (msg.type === "output") {
      const client = this.clients.get(msg.sessionId);
      client?.send(JSON.stringify({ type: "output", data: msg.data }));
    } else if (msg.type === "exit") {
      const client = this.clients.get(msg.sessionId);
      client?.send(JSON.stringify({ type: "exit", code: msg.code }));
    }
  }

  private handleClientMessage(sessionId: string, data: any) {
    let msg: any;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    const nodeId = this.sessionNode.get(sessionId);
    // open
    if (msg.type === "open") {
      const { nodeId: nId, workspaceId, cols, rows } = msg;
      this.sessionNode.set(sessionId, nId);
      this.sessionWorkspace.set(sessionId, workspaceId ?? null);
      const agent = this.agents.get(nId);
      if (!agent) {
        const client = this.clients.get(sessionId);
        client?.send(JSON.stringify({ type: "error", message: "Agent not connected" }));
        return;
      }
      agent.ws.send(JSON.stringify({ type: "open", sessionId, cols, rows, workspaceId, cwd: null }));
      return;
    }
    const agent = nodeId ? this.agents.get(nodeId) : null;
    if (!agent) return;
    if (msg.type === "input") {
      agent.ws.send(JSON.stringify({ type: "input", sessionId, data: msg.data }));
    } else if (msg.type === "resize") {
      agent.ws.send(JSON.stringify({ type: "resize", sessionId, cols: msg.cols, rows: msg.rows }));
    } else if (msg.type === "close") {
      agent.ws.send(JSON.stringify({ type: "close", sessionId }));
    }
  }

  createSession(nodeId: string, workspaceId?: string | null): string {
    const id = newId("term");
    this.sessionNode.set(id, nodeId);
    this.sessionWorkspace.set(id, workspaceId ?? null);
    return id;
  }

  listAgents(): string[] { return [...this.agents.keys()]; }
}