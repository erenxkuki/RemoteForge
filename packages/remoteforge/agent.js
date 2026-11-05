#!/usr/bin/env node

// ../agent/src/config.ts
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
var CONFIG_DIR = path.join(os.homedir(), ".remoteforge");
var CONFIG_FILE = path.join(CONFIG_DIR, "agent.json");
async function loadConfig() {
  try {
    const raw = await readFile(CONFIG_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
async function saveConfig(cfg) {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 384 });
}

// ../agent/src/terminal.ts
import WebSocket from "ws";
import os2 from "node:os";
import { createRequire } from "node:module";
var requireFn = createRequire(import.meta.url);
var pty = null;
try {
  const modName = "node-pty";
  pty = requireFn(modName);
} catch (e) {
  console.warn("node-pty not available; terminal features disabled:", e?.message);
}
var persistentTerms = /* @__PURE__ */ new Map();
function connectTerminalWs(serverUrl, nodeId, token) {
  const wsUrl = serverUrl.replace(/^http/, "ws").replace(/\/$/, "") + `/ws/agent?token=${encodeURIComponent(token)}&nodeId=${encodeURIComponent(nodeId)}`;
  const ws = new WebSocket(wsUrl);
  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg.type === "open") {
      const { sessionId, cols, rows } = msg;
      let pt = persistentTerms.get(sessionId);
      if (pt) {
        pt.clients.add(ws);
        ws.send(JSON.stringify({ type: "output", sessionId, data: pt.buffer }));
        try {
          pt.term.resize(cols || 80, rows || 24);
        } catch (e) {
        }
        return;
      }
      if (!pty) {
        ws.send(JSON.stringify({ type: "error", sessionId, message: "node-pty not available on this VPS" }));
        return;
      }
      const shell = os2.platform() === "win32" ? "powershell.exe" : "bash";
      const term = pty.spawn(shell, [], {
        name: "xterm-256color",
        cols: cols || 80,
        rows: rows || 24,
        cwd: process.cwd(),
        env: process.env
      });
      const newPt = { term, buffer: "", clients: /* @__PURE__ */ new Set([ws]) };
      persistentTerms.set(sessionId, newPt);
      term.onData((d) => {
        newPt.buffer += d;
        if (newPt.buffer.length > 65536) newPt.buffer = newPt.buffer.slice(-65536);
        for (const c of newPt.clients) {
          try {
            c.send(JSON.stringify({ type: "output", sessionId, data: d }));
          } catch (e) {
          }
        }
      });
      term.onExit(({ exitCode }) => {
        for (const c of newPt.clients) {
          try {
            c.send(JSON.stringify({ type: "exit", sessionId, code: exitCode }));
          } catch (e) {
          }
        }
        persistentTerms.delete(sessionId);
      });
    } else if (msg.type === "input") {
      const pt = persistentTerms.get(msg.sessionId);
      pt?.term.write(msg.data);
    } else if (msg.type === "resize") {
      const pt = persistentTerms.get(msg.sessionId);
      try {
        pt?.term.resize(msg.cols, msg.rows);
      } catch (e) {
      }
    } else if (msg.type === "close") {
      const pt = persistentTerms.get(msg.sessionId);
      try {
        pt?.term.kill();
      } catch (e) {
      }
      persistentTerms.delete(msg.sessionId);
    }
  });
  ws.on("close", () => {
    for (const pt of persistentTerms.values()) {
      pt.clients.delete(ws);
    }
  });
  return ws;
}

// ../agent/src/client.ts
var AgentClient = class {
  constructor(serverUrl, token) {
    this.serverUrl = serverUrl;
    this.token = token;
  }
  serverUrl;
  token;
  setToken(t) {
    this.token = t;
  }
  headers(extra) {
    const h = { "Content-Type": "application/json", ...extra ?? {} };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }
  async request(method, path4, body, extraHeaders) {
    const url = this.serverUrl.replace(/\/$/, "") + path4;
    const res = await fetch(url, {
      method,
      headers: this.headers(extraHeaders),
      body: body !== void 0 ? JSON.stringify(body) : void 0
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const err = new Error(data?.message ?? `HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }
};

// ../agent/src/index.ts
import os4 from "node:os";

// ../agent/src/executor.ts
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, statSync, existsSync } from "node:fs";
import path2 from "node:path";
import os3 from "node:os";
var WORKSPACE_BASE = path2.join(os3.homedir(), ".remoteforge", "workspaces");
function ensureDir(p) {
  mkdirSync(p, { recursive: true });
}
function safePath(root, rel) {
  const resolved = path2.resolve(root, rel || ".");
  if (resolved !== root && !resolved.startsWith(root + path2.sep)) {
    throw new Error("Path traversal detected");
  }
  return resolved;
}
function listFilesRecursive(root, rel = ".") {
  const base = safePath(root, rel);
  const out = [];
  function walk(dir, prefix) {
    for (const name of readdirSync(dir)) {
      const full = path2.join(dir, name);
      const st = statSync(full);
      const rpath = prefix ? prefix + "/" + name : name;
      out.push({ path: rpath, type: st.isDirectory() ? "dir" : "file", size: st.size, mode: st.mode });
      if (st.isDirectory()) walk(full, rpath);
    }
  }
  if (existsSync(base)) walk(base, rel === "." ? "" : rel);
  return out;
}
async function runCommand(ctx, payload, onLog) {
  const { command, args: args2 = [], cwd, env = {}, timeoutMs } = payload;
  const workdir = cwd ? safePath(ctx.workspaceRoot, cwd) : ctx.workspaceRoot;
  return new Promise((resolve) => {
    const child = spawn(command, args2, { cwd: workdir, env: { ...process.env, ...env }, shell: false });
    let stdout = "";
    let stderr = "";
    const timer = timeoutMs ? setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
      }
    }, timeoutMs) : null;
    child.stdout.on("data", (d) => {
      const s = d.toString();
      stdout += s;
      onLog(s);
    });
    child.stderr.on("data", (d) => {
      const s = d.toString();
      stderr += s;
      onLog(s);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ exitCode: code ?? 0, stdout, stderr });
    });
    child.on("error", (e) => {
      if (timer) clearTimeout(timer);
      resolve({ exitCode: 1, stdout, stderr: stderr + e.message });
    });
  });
}
function resolveWorkspacePath(workspaceId, name) {
  const direct = path2.join(WORKSPACE_BASE, workspaceId);
  if (existsSync(direct)) return direct;
  try {
    const entries = readdirSync(WORKSPACE_BASE);
    const match = entries.find((e) => e === workspaceId || e.endsWith("-" + workspaceId));
    if (match) return path2.join(WORKSPACE_BASE, match);
  } catch {
  }
  mkdirSync(direct, { recursive: true });
  return direct;
}
function makeWorkspaceDir(name, id) {
  const dir = path2.join(WORKSPACE_BASE, id);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ../agent/src/index.ts
import { mkdirSync as mkdirSync2, rmSync as rmSync2, readFileSync as readFileSync2, writeFileSync as writeFileSync2, existsSync as existsSync2 } from "node:fs";
import { spawn as spawn2 } from "node:child_process";
import path3 from "node:path";
import { spawnSync as spawnSync2 } from "node:child_process";
var args = process.argv.slice(2);
var cmd = args[0];
function getFlag(name) {
  const i = args.indexOf(name);
  if (i >= 0 && i + 1 < args.length) return args[i + 1];
  return void 0;
}
async function pair() {
  const serverUrl = getFlag("--server") ?? process.env.REMOTE_FORGE_SERVER ?? "http://localhost:8787";
  const name = getFlag("--name") ?? os4.hostname();
  const client = new AgentClient(serverUrl);
  const init = await client.request("POST", "/api/pairing/initiate", {
    name,
    hostname: os4.hostname(),
    os: `${os4.platform()} ${os4.release()}`,
    arch: os4.arch(),
    agentVersion: "0.2.0"
  });
  console.log("Pairing initiated.");
  console.log("Pairing ID:", init.pairingId);
  console.log("Pairing code (give to operator):", init.code);
  console.log("Pairing secret (keep private):", init.pairingSecret);
  console.log("Expires at:", new Date(init.expiresAt).toISOString());
  console.log("Waiting for operator approval...");
  const started = Date.now();
  const timeoutMs = 10 * 60 * 1e3;
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await client.request("POST", `/api/pairing/${init.pairingId}/claim`, { pairingSecret: init.pairingSecret }, { "X-Pairing-Secret": init.pairingSecret });
      const finalCfg = { serverUrl, nodeId: res.node.id, nodeToken: res.nodeToken, name };
      await saveConfig(finalCfg);
      console.log("Paired successfully. Node ID:", res.node.id);
      return;
    } catch (e) {
      if (e?.status === 409) process.stdout.write(".");
      else if (e?.status === 410) {
        console.error("\nPairing expired.");
        process.exit(1);
      } else console.error("\nClaim error:", e?.message);
    }
    await new Promise((r) => setTimeout(r, 3e3));
  }
  console.error("\nTimed out waiting for approval.");
  process.exit(1);
}
async function handleJob(client, cfg, job) {
  const log = (c) => {
    client.request("POST", `/api/jobs/${job.id}/log`, { chunk: c }).catch(() => {
    });
  };
  let exitCode = 0;
  try {
    let result = {};
    const payload = job.payload || {};
    const wsPath = job.workspaceId ? resolveWorkspacePath(job.workspaceId, job.payload?.name) : WORKSPACE_BASE;
    ensureDir(WORKSPACE_BASE);
    switch (job.type) {
      case "create_workspace": {
        const dir = makeWorkspaceDir(payload.name || job.workspaceId, job.workspaceId);
        result = { path: dir };
        break;
      }
      case "destroy_workspace": {
        if (existsSync2(wsPath)) rmSync2(wsPath, { recursive: true, force: true });
        result = { destroyed: true };
        break;
      }
      case "list_files": {
        const files = listFilesRecursive(wsPath, payload.path || ".");
        result = { files };
        break;
      }
      case "read_file": {
        const full = safePath(wsPath, payload.path);
        const buf = readFileSync2(full);
        result = { content: buf.toString("base64"), encoding: "base64", size: buf.length };
        break;
      }
      case "write_file": {
        const full = safePath(wsPath, payload.path);
        mkdirSync2(path3.dirname(full), { recursive: true });
        const buf = payload.encoding === "utf8" ? Buffer.from(payload.content, "utf8") : Buffer.from(payload.content, "base64");
        writeFileSync2(full, buf);
        result = { written: true, size: buf.length };
        break;
      }
      case "run_command": {
        const r = await runCommand({ serverUrl: cfg.serverUrl, nodeToken: cfg.nodeToken, workspaceRoot: wsPath }, payload, log);
        exitCode = r.exitCode;
        result = { stdout: r.stdout, stderr: r.stderr };
        if (exitCode !== 0) throw new Error(`Command exited with code ${exitCode}`);
        break;
      }
      case "install_dependencies": {
        const mgr = payload.manager || "npm";
        const cmdMap = { npm: ["npm", ["install", ...payload.args || []]], pip: ["pip", ["install", ...payload.args || []]], cargo: ["cargo", ["build", ...payload.args || []]] };
        const [c, a] = cmdMap[mgr] || ["npm", ["install", ...payload.args || []]];
        const r = await runCommand({ serverUrl: cfg.serverUrl, nodeToken: cfg.nodeToken, workspaceRoot: wsPath }, { command: c, args: a, cwd: payload.cwd, env: payload.env, timeoutMs: payload.timeoutMs }, log);
        exitCode = r.exitCode;
        result = { stdout: r.stdout, stderr: r.stderr };
        if (exitCode !== 0) throw new Error(`Install failed with code ${exitCode}`);
        break;
      }
      case "start_process": {
        const cmdStr = [payload.command, ...payload.args || []].map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ");
        const cwd = payload.cwd ? safePath(wsPath, payload.cwd) : wsPath;
        const logFile = path3.join(os4.tmpdir(), `rf-proc-${job.id}.log`);
        const pidFile = path3.join(os4.tmpdir(), `rf-proc-${job.id}.pid`);
        const envStr = Object.entries(payload.env || {}).map(([k, v]) => `${k}='${String(v).replace(/'/g, "'\\''")}'`).join(" ");
        const fullCmd = `cd '${cwd.replace(/'/g, "'\\''")}' && ${envStr ? envStr + " " : ""}nohup ${cmdStr} > '${logFile}' 2>&1 & echo $! > '${pidFile}' && disown`;
        const r = spawnSync2("bash", ["-c", fullCmd], { encoding: "utf8", timeout: 5e3 });
        let pid = null;
        try {
          pid = parseInt(readFileSync2(pidFile, "utf8").trim(), 10);
        } catch {
        }
        if (!pid || isNaN(pid)) {
          const child = spawn2(payload.command, payload.args || [], { cwd, env: { ...process.env, ...payload.env || {} }, detached: true, stdio: "ignore" });
          child.unref();
          pid = child.pid;
        }
        result = { pid, logFile, persistent: true };
        break;
      }
      case "stop_process": {
        const pid = payload.pid;
        try {
          process.kill(pid, "SIGTERM");
        } catch {
        }
        result = { stopped: true };
        break;
      }
      case "get_process_status": {
        const pid = payload.pid;
        let running = false;
        try {
          process.kill(pid, 0);
          running = true;
        } catch {
          running = false;
        }
        result = { pid, running };
        break;
      }
      case "build": {
        let image = null;
        let cmd2 = payload.command || "npm";
        let bArgs = payload.args && payload.args.length ? payload.args : ["run", "build"];
        let env = payload.env || {};
        try {
          const profs = await client.request("GET", "/api/build-profiles");
          const prof = (profs.items || []).find((p) => p.name === payload.profile);
          if (prof) {
            image = prof.image;
            if (!payload.command) cmd2 = prof.command;
            if (!payload.args || !payload.args.length) bArgs = prof.args;
            env = { ...prof.env, ...env };
          }
        } catch {
        }
        const dockerCheck = spawnSync2("docker", ["--version"], { encoding: "utf8" });
        const useDocker = dockerCheck.status === 0 && image;
        if (useDocker) {
          const dockerArgs = ["run", "--rm", "--cpus=2", "--memory=2g", "--network=bridge", "-v", `${wsPath}:/workspace`, "-w", "/workspace"];
          for (const [k, v] of Object.entries(env)) dockerArgs.push("-e", `${k}=${v}`);
          dockerArgs.push(image, cmd2, ...bArgs);
          const r = await runCommand({ serverUrl: cfg.serverUrl, nodeToken: cfg.nodeToken, workspaceRoot: wsPath }, { command: "docker", args: dockerArgs, cwd: payload.cwd, env: payload.env, timeoutMs: payload.timeoutMs || 6e5 }, log);
          exitCode = r.exitCode;
          result = { stdout: r.stdout, stderr: r.stderr, docker: true, image };
          if (exitCode !== 0) throw new Error(`Build failed with code ${exitCode}`);
        } else {
          const r = await runCommand({ serverUrl: cfg.serverUrl, nodeToken: cfg.nodeToken, workspaceRoot: wsPath }, { command: cmd2, args: bArgs, cwd: payload.cwd, env, timeoutMs: payload.timeoutMs || 6e5 }, log);
          exitCode = r.exitCode;
          result = { stdout: r.stdout, stderr: r.stderr, docker: false };
          if (exitCode !== 0) throw new Error(`Build failed with code ${exitCode}`);
        }
        break;
      }
      case "collect_artifacts": {
        const outDir = payload.path || ".";
        const tarName = `artifact-${job.id}.tar.gz`;
        const tarPath = path3.join(os4.tmpdir(), tarName);
        const r = spawnSync2("tar", ["-czf", tarPath, "-C", wsPath, outDir], { encoding: "utf8" });
        if (r.status !== 0) throw new Error(r.stderr || "tar failed");
        const buf = readFileSync2(tarPath);
        const uploadRes = await client.request("POST", `/api/workspaces/${job.workspaceId}/artifacts`, { filename: tarName, content: buf.toString("base64") });
        rmSync2(tarPath, { force: true });
        result = { artifactId: uploadRes.artifactId, size: buf.length };
        break;
      }
      case "upload_project": {
        const uploadId = payload.uploadId;
        const res = await fetch(cfg.serverUrl.replace(/\/$/, "") + `/api/uploads/${uploadId}`, { headers: { Authorization: `Bearer ${cfg.nodeToken}` } });
        if (!res.ok) throw new Error(`Download failed: ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        const zipPath = path3.join(WORKSPACE_BASE, `upload-${uploadId}.tar.gz`);
        writeFileSync2(zipPath, buf);
        if (!existsSync2(wsPath)) mkdirSync2(wsPath, { recursive: true });
        const r = spawnSync2("tar", ["-xzf", zipPath, "-C", wsPath], { encoding: "utf8" });
        rmSync2(zipPath, { force: true });
        if (r.status !== 0) throw new Error(r.stderr || "extract failed");
        result = { extracted: true };
        break;
      }
      case "download_project": {
        const tarName = `project-${job.id}.tar.gz`;
        const tarPath = path3.join(WORKSPACE_BASE, tarName);
        const r = spawnSync2("tar", ["-czf", tarPath, "-C", wsPath, "."], { encoding: "utf8" });
        if (r.status !== 0) throw new Error(r.stderr || "tar failed");
        const buf = readFileSync2(tarPath);
        const uploadRes = await client.request("POST", `/api/workspaces/${job.workspaceId}/artifacts`, { filename: tarName, content: buf.toString("base64") });
        rmSync2(tarPath, { force: true });
        result = { artifactId: uploadRes.artifactId, size: buf.length };
        break;
      }
      case "tmux_create": {
        const name = payload.sessionName;
        const cmd2 = payload.command || "bash";
        const args2 = payload.args || [];
        const cwd = payload.cwd ? safePath(wsPath, payload.cwd) : wsPath;
        spawnSync2("tmux", ["kill-session", "-t", name], { encoding: "utf8" });
        const fullCmd = args2.length ? `${cmd2} ${args2.join(" ")}` : cmd2;
        const r = spawnSync2("tmux", ["new-session", "-d", "-s", name, "-c", cwd, fullCmd], { encoding: "utf8" });
        if (r.status !== 0) throw new Error(r.stderr || "tmux new-session failed");
        result = { sessionName: name, created: true, cwd };
        break;
      }
      case "tmux_send": {
        const name = payload.sessionName;
        const r = spawnSync2("tmux", ["send-keys", "-t", name, payload.keys, "Enter"], { encoding: "utf8" });
        if (r.status !== 0) throw new Error(r.stderr || "tmux send-keys failed");
        result = { sessionName: name, sent: true };
        break;
      }
      case "tmux_capture": {
        const name = payload.sessionName;
        const lines = payload.lines || 100;
        const r = spawnSync2("tmux", ["capture-pane", "-t", name, "-p", "-S", `-${lines}`], { encoding: "utf8" });
        if (r.status !== 0) throw new Error(r.stderr || "tmux capture-pane failed");
        result = { sessionName: name, output: r.stdout };
        break;
      }
      case "tmux_list": {
        const r = spawnSync2("tmux", ["list-sessions", "-F", "#{session_name}:#{session_created}:#{session_attached}"], { encoding: "utf8" });
        const sessions = (r.stdout || "").trim().split("\n").filter(Boolean).map((line) => {
          const [name, created, attached] = line.split(":");
          return { name, created: Number(created), attached: attached === "1" };
        });
        result = { sessions };
        break;
      }
      case "tmux_kill": {
        const name = payload.sessionName;
        const r = spawnSync2("tmux", ["kill-session", "-t", name], { encoding: "utf8" });
        if (r.status !== 0) throw new Error(r.stderr || "tmux kill-session failed");
        result = { sessionName: name, killed: true };
        break;
      }
      default:
        throw new Error(`Unknown job type: ${job.type}`);
    }
    await client.request("POST", `/api/jobs/${job.id}/finish`, { status: "succeeded", result, exitCode, logs: "" });
  } catch (e) {
    await client.request("POST", `/api/jobs/${job.id}/finish`, { status: "failed", result: { error: e.message }, exitCode: exitCode || 1, logs: e.message }).catch(() => {
    });
  }
}
async function runDaemon() {
  const cfg = await loadConfig();
  if (!cfg || !cfg.nodeToken || !cfg.nodeId) {
    console.error("Agent not paired. Run: remoteforge-agent pair --server <url>");
    process.exit(1);
  }
  const client = new AgentClient(cfg.serverUrl, cfg.nodeToken);
  console.log("Starting RemoteForge agent for node", cfg.nodeId);
  ensureDir(WORKSPACE_BASE);
  connectTerminalWs(cfg.serverUrl, cfg.nodeId, cfg.nodeToken);
  const heartbeat = async () => {
    try {
      await client.request("POST", `/api/nodes/${cfg.nodeId}/heartbeat`, { status: "online" });
    } catch (e) {
      console.error("Heartbeat failed:", e?.message);
    }
  };
  await heartbeat();
  setInterval(heartbeat, 15e3);
  const poll = async () => {
    try {
      const res = await client.request("GET", `/api/nodes/${cfg.nodeId}/jobs/next`);
      if (res.job) {
        console.log("Claimed job", res.job.id, res.job.type);
        handleJob(client, cfg, res.job);
      }
    } catch (e) {
    }
  };
  setInterval(poll, 2e3);
  await new Promise(() => {
  });
}
async function status() {
  const cfg = await loadConfig();
  console.log(JSON.stringify(cfg, null, 2));
}
async function main() {
  switch (cmd) {
    case "pair":
      await pair();
      break;
    case "run":
      await runDaemon();
      break;
    case "status":
      await status();
      break;
    default:
      console.log("Usage: remoteforge-agent <pair|run|status> [--server URL] [--name NAME]");
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
