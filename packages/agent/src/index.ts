import { loadConfig, saveConfig, defaultConfig } from "./config.js";
import { connectTerminalWs } from "./terminal.js";
import { AgentClient } from "./client.js";
import os from "node:os";
import {
  ensureDir,
  safePath,
  listFilesRecursive,
  runCommand,
  makeWorkspaceDir,
  WORKSPACE_BASE,
} from "./executor.js";
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const cmd = args[0];

function getFlag(name: string): string | undefined {
  const i = args.indexOf(name);
  if (i >= 0 && i + 1 < args.length) return args[i + 1];
  return undefined;
}

async function pair() {
  const serverUrl = getFlag("--server") ?? process.env.REMOTE_FORGE_SERVER ?? "http://localhost:8787";
  const name = getFlag("--name") ?? os.hostname();
  const client = new AgentClient(serverUrl);
  const init = await client.request("POST", "/api/pairing/initiate", {
    name,
    hostname: os.hostname(),
    os: `${os.platform()} ${os.release()}`,
    arch: os.arch(),
    agentVersion: "0.2.0",
  });
  console.log("Pairing initiated.");
  console.log("Pairing ID:", init.pairingId);
  console.log("Pairing code (give to operator):", init.code);
  console.log("Pairing secret (keep private):", init.pairingSecret);
  console.log("Expires at:", new Date(init.expiresAt).toISOString());
  console.log("Waiting for operator approval...");

  const started = Date.now();
  const timeoutMs = 10 * 60 * 1000;
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await client.request("POST", `/api/pairing/${init.pairingId}/claim`, { pairingSecret: init.pairingSecret }, { "X-Pairing-Secret": init.pairingSecret });
      const finalCfg = { serverUrl, nodeId: res.node.id, nodeToken: res.nodeToken, name };
      await saveConfig(finalCfg);
      console.log("Paired successfully. Node ID:", res.node.id);
      return;
    } catch (e: any) {
      if (e?.status === 409) process.stdout.write(".");
      else if (e?.status === 410) { console.error("\nPairing expired."); process.exit(1); }
      else console.error("\nClaim error:", e?.message);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.error("\nTimed out waiting for approval.");
  process.exit(1);
}

// Agent-side process registry
const processes = new Map<number, any>();

async function handleJob(client: AgentClient, cfg: any, job: any): Promise<void> {
  const log = (c: string) => { client.request("POST", `/api/jobs/${job.id}/log`, { chunk: c }).catch(() => {}); };
  let exitCode = 0;
  try {
    let result: any = {};
    const payload = job.payload || {};
    const wsPath = (job.workspaceId ? path.join(WORKSPACE_BASE, job.workspaceId) : WORKSPACE_BASE);
    // ensure base
    ensureDir(WORKSPACE_BASE);

    switch (job.type) {
      case "create_workspace": {
        const dir = makeWorkspaceDir(payload.name || job.workspaceId, job.workspaceId);
        result = { path: dir };
        break;
      }
      case "destroy_workspace": {
        if (existsSync(wsPath)) rmSync(wsPath, { recursive: true, force: true });
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
        const buf = readFileSync(full);
        result = { content: buf.toString("base64"), encoding: "base64", size: buf.length };
        break;
      }
      case "write_file": {
        const full = safePath(wsPath, payload.path);
        mkdirSync(path.dirname(full), { recursive: true });
        const buf = payload.encoding === "utf8" ? Buffer.from(payload.content, "utf8") : Buffer.from(payload.content, "base64");
        writeFileSync(full, buf);
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
        const cmdMap: any = { npm: ["npm", ["install", ...(payload.args || [])]], pip: ["pip", ["install", ...(payload.args || [])]], cargo: ["cargo", ["build", ...(payload.args || [])]] };
        const [c, a] = cmdMap[mgr] || ["npm", ["install", ...(payload.args || [])]];
        const r = await runCommand({ serverUrl: cfg.serverUrl, nodeToken: cfg.nodeToken, workspaceRoot: wsPath }, { command: c, args: a, cwd: payload.cwd, env: payload.env, timeoutMs: payload.timeoutMs }, log);
        exitCode = r.exitCode;
        result = { stdout: r.stdout, stderr: r.stderr };
        if (exitCode !== 0) throw new Error(`Install failed with code ${exitCode}`);
        break;
      }
      case "start_process": {
        // Fully detached daemon: nohup + disown so it survives agent restart
        const cmdStr = [payload.command, ...(payload.args || [])].map((a: string) => `'${a.replace(/'/g, "'\\''")}'`).join(" ");
        const cwd = payload.cwd ? safePath(wsPath, payload.cwd) : wsPath;
        const logFile = path.join(os.tmpdir(), `rf-proc-${job.id}.log`);
        const pidFile = path.join(os.tmpdir(), `rf-proc-${job.id}.pid`);
        const envStr = Object.entries(payload.env || {}).map(([k,v]) => `${k}='${String(v).replace(/'/g,"'\\''")}'`).join(" ");
        const fullCmd = `cd '${cwd.replace(/'/g,"'\\''")}' && ${envStr ? envStr + " " : ""}nohup ${cmdStr} > '${logFile}' 2>&1 & echo $! > '${pidFile}' && disown`;
        const r = spawnSync("bash", ["-c", fullCmd], { encoding: "utf8", timeout: 5000 });
        // read pid
        let pid: number | null = null;
        try { pid = parseInt(readFileSync(pidFile, "utf8").trim(), 10); } catch {}
        if (!pid || isNaN(pid)) {
          // fallback: direct spawn detached
          const child = spawn(payload.command, payload.args || [], { cwd, env: { ...process.env, ...(payload.env || {}) }, detached: true, stdio: "ignore" });
          child.unref();
          pid = child.pid!;
        }
        result = { pid, logFile, persistent: true };
        break;
      }
      case "stop_process": {
        const pid = payload.pid;
        try { process.kill(pid, "SIGTERM"); } catch {}
        result = { stopped: true };
        break;
      }
      case "get_process_status": {
        const pid = payload.pid;
        let running = false;
        try { process.kill(pid, 0); running = true; } catch { running = false; }
        result = { pid, running };
        break;
      }
      case "build": {
        // resolve profile
        let image: string | null = null;
        let cmd = payload.command || "npm";
        let bArgs = payload.args && payload.args.length ? payload.args : ["run", "build"];
        let env = payload.env || {};
        // try to fetch profile from server
        try {
          const profs = await client.request("GET", "/api/build-profiles");
          const prof = (profs.items || []).find((p: any) => p.name === payload.profile);
          if (prof) {
            image = prof.image;
            if (!payload.command) cmd = prof.command;
            if (!payload.args || !payload.args.length) bArgs = prof.args;
            env = { ...prof.env, ...env };
          }
        } catch {}
        // check docker
        const dockerCheck = spawnSync("docker", ["--version"], { encoding: "utf8" });
        const useDocker = dockerCheck.status === 0 && image;
        if (useDocker) {
          const dockerArgs = ["run", "--rm", "--cpus=2", "--memory=2g", "--network=bridge", "-v", `${wsPath}:/workspace`, "-w", "/workspace"];
          for (const [k, v] of Object.entries(env)) dockerArgs.push("-e", `${k}=${v}`);
          dockerArgs.push(image as string, cmd, ...bArgs);
          const r = await runCommand({ serverUrl: cfg.serverUrl, nodeToken: cfg.nodeToken, workspaceRoot: wsPath }, { command: "docker", args: dockerArgs, cwd: payload.cwd, env: payload.env, timeoutMs: payload.timeoutMs || 600000 }, log);
          exitCode = r.exitCode;
          result = { stdout: r.stdout, stderr: r.stderr, docker: true, image };
          if (exitCode !== 0) throw new Error(`Build failed with code ${exitCode}`);
        } else {
          const r = await runCommand({ serverUrl: cfg.serverUrl, nodeToken: cfg.nodeToken, workspaceRoot: wsPath }, { command: cmd, args: bArgs, cwd: payload.cwd, env, timeoutMs: payload.timeoutMs || 600000 }, log);
          exitCode = r.exitCode;
          result = { stdout: r.stdout, stderr: r.stderr, docker: false };
          if (exitCode !== 0) throw new Error(`Build failed with code ${exitCode}`);
        }
        break;
      }
      case "collect_artifacts": {
        const outDir = payload.path || ".";
        const tarName = `artifact-${job.id}.tar.gz`;
        const tarPath = path.join(os.tmpdir(), tarName);
        const r = spawnSync("tar", ["-czf", tarPath, "-C", wsPath, outDir], { encoding: "utf8" });
        if (r.status !== 0) throw new Error(r.stderr || "tar failed");
        const buf = readFileSync(tarPath);
        const uploadRes = await client.request("POST", `/api/workspaces/${job.workspaceId}/artifacts`, { filename: tarName, content: buf.toString("base64") });
        rmSync(tarPath, { force: true });
        result = { artifactId: uploadRes.artifactId, size: buf.length };
        break;
      }
      case "upload_project": {
        // download upload from server
        const uploadId = payload.uploadId;
        const res = await fetch(cfg.serverUrl.replace(/\/$/, "") + `/api/uploads/${uploadId}`, { headers: { Authorization: `Bearer ${cfg.nodeToken}` } });
        if (!res.ok) throw new Error(`Download failed: ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        const zipPath = path.join(WORKSPACE_BASE, `upload-${uploadId}.tar.gz`);
        writeFileSync(zipPath, buf);
        // extract
        if (!existsSync(wsPath)) mkdirSync(wsPath, { recursive: true });
        const r = spawnSync("tar", ["-xzf", zipPath, "-C", wsPath], { encoding: "utf8" });
        rmSync(zipPath, { force: true });
        if (r.status !== 0) throw new Error(r.stderr || "extract failed");
        result = { extracted: true };
        break;
      }
      case "download_project": {
        // tar workspace and upload as artifact
        const tarName = `project-${job.id}.tar.gz`;
        const tarPath = path.join(WORKSPACE_BASE, tarName);
        const r = spawnSync("tar", ["-czf", tarPath, "-C", wsPath, "."], { encoding: "utf8" });
        if (r.status !== 0) throw new Error(r.stderr || "tar failed");
        const buf = readFileSync(tarPath);
        const uploadRes = await client.request("POST", `/api/workspaces/${job.workspaceId}/artifacts`, { filename: tarName, content: buf.toString("base64") });
        rmSync(tarPath, { force: true });
        result = { artifactId: uploadRes.artifactId, size: buf.length };
        break;
      }
      default:
        throw new Error(`Unknown job type: ${job.type}`);
    }

    await client.request("POST", `/api/jobs/${job.id}/finish`, { status: "succeeded", result, exitCode, logs: "" });
  } catch (e: any) {
    await client.request("POST", `/api/jobs/${job.id}/finish`, { status: "failed", result: { error: e.message }, exitCode: exitCode || 1, logs: e.message }).catch(() => {});
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

  // terminal websocket
  connectTerminalWs(cfg.serverUrl, cfg.nodeId, cfg.nodeToken, () => {});

  const heartbeat = async () => {
    try { await client.request("POST", `/api/nodes/${cfg.nodeId}/heartbeat`, { status: "online" }); }
    catch (e: any) { console.error("Heartbeat failed:", e?.message); }
  };
  await heartbeat();
  setInterval(heartbeat, 15000);

  // job polling loop
  const poll = async () => {
    try {
      const res = await client.request("GET", `/api/nodes/${cfg.nodeId}/jobs/next`);
      if (res.job) {
        console.log("Claimed job", res.job.id, res.job.type);
        handleJob(client, cfg, res.job); // fire and forget
      }
    } catch (e: any) {
      // ignore
    }
  };
  setInterval(poll, 2000);
  await new Promise(() => {});
}

async function status() {
  const cfg = await loadConfig();
  console.log(JSON.stringify(cfg, null, 2));
}

async function main() {
  switch (cmd) {
    case "pair": await pair(); break;
    case "run": await runDaemon(); break;
    case "status": await status(); break;
    default: console.log("Usage: remoteforge-agent <pair|run|status> [--server URL] [--name NAME]");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });