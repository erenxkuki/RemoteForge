import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, readdirSync, statSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export interface ExecContext {
  serverUrl: string;
  nodeToken: string;
  workspaceRoot: string; // base dir for workspaces
}

export const WORKSPACE_BASE = path.join(os.homedir(), ".remoteforge", "workspaces");

export function ensureDir(p: string) { mkdirSync(p, { recursive: true }); }

export function safePath(root: string, rel: string): string {
  const resolved = path.resolve(root, rel || ".");
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error("Path traversal detected");
  }
  return resolved;
}

export function listFilesRecursive(root: string, rel: string = "."): any[] {
  const base = safePath(root, rel);
  const out: any[] = [];
  function walk(dir: string, prefix: string) {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      const st = statSync(full);
      const rpath = prefix ? prefix + "/" + name : name;
      out.push({ path: rpath, type: st.isDirectory() ? "dir" : "file", size: st.size, mode: st.mode });
      if (st.isDirectory()) walk(full, rpath);
    }
  }
  if (existsSync(base)) walk(base, rel === "." ? "" : rel);
  return out;
}

export async function runCommand(ctx: ExecContext, payload: any, onLog: (c: string) => void): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const { command, args = [], cwd, env = {}, timeoutMs } = payload;
  const workdir = cwd ? safePath(ctx.workspaceRoot, cwd) : ctx.workspaceRoot;
  // if cwd points to a workspace subdir, root check against workspaceRoot; allow
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: workdir, env: { ...process.env, ...env }, shell: false });
    let stdout = "";
    let stderr = "";
    const timer = timeoutMs ? setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, timeoutMs) : null;
    child.stdout.on("data", (d) => { const s = d.toString(); stdout += s; onLog(s); });
    child.stderr.on("data", (d) => { const s = d.toString(); stderr += s; onLog(s); });
    child.on("close", (code) => { if (timer) clearTimeout(timer); resolve({ exitCode: code ?? 0, stdout, stderr }); });
    child.on("error", (e) => { if (timer) clearTimeout(timer); resolve({ exitCode: 1, stdout, stderr: stderr + e.message }); });
  });
}

export function makeWorkspaceDir(name: string, id: string): string {
  const dir = path.join(WORKSPACE_BASE, `${name}-${id}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}