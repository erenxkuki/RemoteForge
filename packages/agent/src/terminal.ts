import WebSocket from "ws";
import os from "node:os";
import { createRequire } from "node:module";

const requireFn = createRequire(import.meta.url);
let pty: any = null;
try {
  const modName = "node-pty";
  pty = requireFn(modName);
} catch (e) {
  console.warn("node-pty not available; terminal features disabled:", (e as any)?.message);
}

interface PersistentTerm {
  term: any;
  buffer: string; // recent output buffer
  clients: Set<WebSocket>;
}

const persistentTerms = new Map<string, PersistentTerm>();

export function connectTerminalWs(serverUrl: string, nodeId: string, token: string) {
  const wsUrl = serverUrl.replace(/^http/, "ws").replace(/\/$/, "") + `/ws/agent?token=${encodeURIComponent(token)}&nodeId=${encodeURIComponent(nodeId)}`;
  const ws = new WebSocket(wsUrl);

  ws.on("message", (data) => {
    let msg: any;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    if (msg.type === "open") {
      const { sessionId, cols, rows } = msg;
      // Reconnect to existing session?
      let pt = persistentTerms.get(sessionId);
      if (pt) {
        // Reattach: send buffered output to new client
        pt.clients.add(ws);
        ws.send(JSON.stringify({ type: "output", sessionId, data: pt.buffer }));
        try { pt.term.resize(cols || 80, rows || 24); } catch (e) {}
        return;
      }
      if (!pty) {
        ws.send(JSON.stringify({ type: "error", sessionId, message: "node-pty not available on this VPS" }));
        return;
      }
      const shell = os.platform() === "win32" ? "powershell.exe" : "bash";
      const term = pty.spawn(shell, [], {
        name: "xterm-256color",
        cols: cols || 80,
        rows: rows || 24,
        cwd: process.cwd(),
        env: process.env as any,
      });
      const newPt: PersistentTerm = { term, buffer: "", clients: new Set([ws]) };
      persistentTerms.set(sessionId, newPt);
      term.onData((d: string) => {
        newPt.buffer += d;
        // keep buffer bounded (last 64KB)
        if (newPt.buffer.length > 65536) newPt.buffer = newPt.buffer.slice(-65536);
        // broadcast to all connected clients
        for (const c of newPt.clients) {
          try { c.send(JSON.stringify({ type: "output", sessionId, data: d })); } catch (e) {}
        }
      });
      term.onExit(({ exitCode }: any) => {
        for (const c of newPt.clients) {
          try { c.send(JSON.stringify({ type: "exit", sessionId, code: exitCode })); } catch (e) {}
        }
        persistentTerms.delete(sessionId);
      });
    } else if (msg.type === "input") {
      const pt = persistentTerms.get(msg.sessionId);
      pt?.term.write(msg.data);
    } else if (msg.type === "resize") {
      const pt = persistentTerms.get(msg.sessionId);
      try { pt?.term.resize(msg.cols, msg.rows); } catch (e) {}
    } else if (msg.type === "close") {
      const pt = persistentTerms.get(msg.sessionId);
      try { pt?.term.kill(); } catch (e) {}
      persistentTerms.delete(msg.sessionId);
    }
  });

  ws.on("close", () => {
    // Do NOT kill terminals — they persist for reconnection.
    // Just remove this client from all terminal client sets.
    for (const pt of persistentTerms.values()) {
      pt.clients.delete(ws);
    }
  });

  return ws;
}