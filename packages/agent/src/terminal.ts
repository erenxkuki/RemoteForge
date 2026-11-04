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

export function connectTerminalWs(serverUrl: string, nodeId: string, token: string, onOpen: (sessionId: string, cols: number, rows: number, cwd: string | null) => void) {
  const wsUrl = serverUrl.replace(/^http/, "ws").replace(/\/$/, "") + `/ws/agent?token=${encodeURIComponent(token)}&nodeId=${encodeURIComponent(nodeId)}`;
  const ws = new WebSocket(wsUrl);
  const ptys = new Map<string, any>();

  ws.on("open", () => { /* registered */ });
  ws.on("message", (data) => {
    let msg: any;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (msg.type === "open") {
      const { sessionId, cols, rows, workspaceId, cwd } = msg;
      if (!pty) {
        ws.send(JSON.stringify({ type: "error", sessionId, message: "node-pty not available on this VPS" }));
        return;
      }
      const shell = os.platform() === "win32" ? "powershell.exe" : "bash";
      const term = pty.spawn(shell, [], {
        name: "xterm-256color",
        cols: cols || 80,
        rows: rows || 24,
        cwd: cwd || process.cwd(),
        env: process.env as any,
      });
      ptys.set(sessionId, term);
      term.onData((d: string) => {
        ws.send(JSON.stringify({ type: "output", sessionId, data: d }));
      });
      term.onExit(({ exitCode }: any) => {
        ws.send(JSON.stringify({ type: "exit", sessionId, code: exitCode }));
        ptys.delete(sessionId);
      });
      onOpen?.(sessionId, cols, rows, cwd);
    } else if (msg.type === "input") {
      const t = ptys.get(msg.sessionId);
      t?.write(msg.data);
    } else if (msg.type === "resize") {
      const t = ptys.get(msg.sessionId);
      try { t?.resize(msg.cols, msg.rows); } catch {}
    } else if (msg.type === "close") {
      const t = ptys.get(msg.sessionId);
      try { t?.kill(); } catch {}
      ptys.delete(msg.sessionId);
    }
  });
  ws.on("close", () => {
    for (const [, t] of ptys) try { t.kill(); } catch {}
    ptys.clear();
  });
  return ws;
}