#!/usr/bin/env node

// ../cli/src/index.ts
import { Command } from "commander";

// ../cli/src/config.ts
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
var CONFIG_DIR = path.join(os.homedir(), ".remoteforge");
var CONFIG_FILE = path.join(CONFIG_DIR, "cli.json");
async function loadConfig() {
  try {
    const raw = await readFile(CONFIG_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return { serverUrl: "http://localhost:8787", token: null, username: null };
  }
}
async function saveConfig(cfg) {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 384 });
}

// ../cli/src/client.ts
var CliClient = class {
  constructor(serverUrl, token) {
    this.serverUrl = serverUrl;
    this.token = token;
  }
  serverUrl;
  token;
  setToken(t) {
    this.token = t;
  }
  headers() {
    const h = { "Content-Type": "application/json" };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }
  async request(method, path4, body) {
    const url = this.serverUrl.replace(/\/$/, "") + path4;
    const res = await fetch(url, { method, headers: this.headers(), body: body !== void 0 ? JSON.stringify(body) : void 0 });
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

// ../cli/src/setup.ts
import path2 from "node:path";
import { fileURLToPath } from "node:url";
import os2 from "node:os";
import { mkdirSync, writeFileSync, existsSync, readFileSync, cpSync, rmSync } from "node:fs";
import * as readline from "node:readline";
var __dirname = path2.dirname(fileURLToPath(import.meta.url));
var c = {
  reset: "\x1B[0m",
  bold: "\x1B[1m",
  dim: "\x1B[2m",
  red: "\x1B[31m",
  green: "\x1B[32m",
  yellow: "\x1B[33m",
  blue: "\x1B[34m",
  magenta: "\x1B[35m",
  cyan: "\x1B[36m",
  white: "\x1B[37m",
  bgBlue: "\x1B[44m"
};
function color(text, ...codes) {
  return codes.join("") + text + c.reset;
}
function success(text) {
  return color("\u2714 " + text, c.green, c.bold);
}
function fail(text) {
  return color("\u2716 " + text, c.red, c.bold);
}
function info(text) {
  return color("\u2139 " + text, c.cyan);
}
function warn(text) {
  return color("\u26A0 " + text, c.yellow);
}
function header(text) {
  return color(text, c.bold, c.magenta);
}
function spinner(text) {
  const frames = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];
  let i = 0;
  const interval = setInterval(() => {
    process.stdout.write(`\r${color(frames[i++ % frames.length], c.cyan)} ${text}`);
  }, 80);
  return {
    stop: (msg) => {
      clearInterval(interval);
      process.stdout.write(`\r${" ".repeat(text.length + 4)}\r`);
      if (msg) console.log(msg);
    }
  };
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
var AGENTS = [
  { key: "opencode", name: "OpenCode", configPath: path2.join(os2.homedir(), ".config", "opencode", "opencode.json"), skillsDir: path2.join(os2.homedir(), ".config", "opencode", "skills"), skillFolder: "opencode" },
  { key: "codex", name: "Codex", configPath: path2.join(os2.homedir(), ".codex", "config.toml"), skillsDir: path2.join(os2.homedir(), ".codex", "skills"), skillFolder: "codex" },
  { key: "claude", name: "Claude Code", configPath: path2.join(os2.homedir(), ".claude", "settings.json"), skillsDir: path2.join(os2.homedir(), ".claude", "skills"), skillFolder: "claude-code" },
  { key: "cursor", name: "Cursor", configPath: path2.join(os2.homedir(), ".cursor", "mcp.json"), skillsDir: null, skillFolder: null },
  { key: "windsurf", name: "Windsurf", configPath: path2.join(os2.homedir(), ".codeium", "windsurf", "mcp_config.json"), skillsDir: null, skillFolder: null },
  { key: "cline", name: "Cline", configPath: path2.join(os2.homedir(), ".cline", "mcp_settings.json"), skillsDir: null, skillFolder: null }
];
function detectAgents() {
  return AGENTS.filter((a) => existsSync(path2.dirname(a.configPath)));
}
var inputLines = [];
function initInput() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin });
    rl.on("line", (line) => inputLines.push(line));
    rl.on("close", () => resolve());
  });
}
var lineIndex = 0;
function ask(q) {
  process.stdout.write(q);
  const ans = lineIndex < inputLines.length ? inputLines[lineIndex++] : "";
  return ans.trim();
}
function resolveMcpPath() {
  const candidates = [
    path2.resolve(__dirname, "mcp.js"),
    path2.resolve(__dirname, "..", "mcp-server", "dist", "index.js"),
    path2.resolve(process.cwd(), "packages", "mcp-server", "dist", "index.js"),
    path2.resolve(process.cwd(), "packages", "remoteforge", "mcp.js")
  ];
  return candidates.find((p) => existsSync(p)) || candidates[0];
}
function resolveSkillSrc(folder) {
  const candidates = [
    path2.resolve(__dirname, "..", "skills", folder),
    path2.resolve(process.cwd(), "skills", folder)
  ];
  return candidates.find((p) => existsSync(p)) || candidates[0];
}
async function runSetup() {
  await initInput();
  console.log();
  console.log(color("\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557", c.magenta, c.bold));
  console.log(color("\u2551     RemoteForge Interactive Setup     \u2551", c.magenta, c.bold));
  console.log(color("\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D", c.magenta, c.bold));
  console.log();
  const detected = detectAgents();
  if (detected.length > 0) {
    console.log(info(`Detected installed agents: ${detected.map((a) => a.name).join(", ")}`));
    console.log();
  }
  console.log(header("Which AI coding agent are you using?\n"));
  AGENTS.forEach((a, i) => {
    const det = detected.includes(a) ? color(" (detected)", c.green) : "";
    console.log(`  ${color(String(i + 1), c.cyan, c.bold)}. ${a.name}${det}`);
  });
  console.log(`  ${color(String(AGENTS.length + 1), c.cyan, c.bold)}. Other / manual
`);
  const choice = ask(color("Enter number: ", c.yellow));
  const idx = parseInt(choice, 10) - 1;
  const agent = idx >= 0 && idx < AGENTS.length ? AGENTS[idx] : null;
  if (!agent) {
    console.log(warn("Manual setup: see docs/mcp-config.md"));
    return;
  }
  const sp = spinner(`Configuring ${agent.name}...`);
  await sleep(300);
  const serverUrl = ask(color("RemoteForge server URL (default http://localhost:8787): ", c.yellow)) || "http://localhost:8787";
  const token = ask(color("Session token (leave blank to configure later): ", c.yellow));
  const mcpPath = resolveMcpPath();
  const mcpEntry = {
    command: "node",
    args: [mcpPath],
    env: {
      REMOTE_FORGE_SERVER: serverUrl,
      REMOTE_FORGE_TOKEN: token || "<paste-session-token-here>"
    }
  };
  mkdirSync(path2.dirname(agent.configPath), { recursive: true });
  let cfg = {};
  if (existsSync(agent.configPath)) {
    try {
      cfg = JSON.parse(readFileSync(agent.configPath, "utf8"));
    } catch {
      cfg = {};
    }
  }
  if (agent.key === "codex") {
    const toml = `# RemoteForge
[mcp_servers.remoteforge]
command = "node"
args = [${mcpEntry.args.map((a) => `"${a}"`).join(", ")}]

[mcp_servers.remoteforge.env]
REMOTE_FORGE_SERVER = "${serverUrl}"
REMOTE_FORGE_TOKEN = "${token || "<paste-session-token-here>"}"
`;
    writeFileSync(agent.configPath, toml);
  } else if (agent.key === "opencode") {
    cfg.mcp = cfg.mcp || {};
    cfg.mcp.servers = cfg.mcp.servers || {};
    cfg.mcp.servers.remoteforge = mcpEntry;
    writeFileSync(agent.configPath, JSON.stringify(cfg, null, 2));
  } else {
    cfg.mcpServers = cfg.mcpServers || {};
    cfg.mcpServers.remoteforge = mcpEntry;
    writeFileSync(agent.configPath, JSON.stringify(cfg, null, 2));
  }
  sp.stop(success(`MCP config written to ${agent.configPath}`));
  if (agent.skillsDir && agent.skillFolder) {
    const skillSrc = resolveSkillSrc(agent.skillFolder === "claude-code" ? "claude-code" : agent.skillFolder);
    if (existsSync(skillSrc)) {
      const sp2 = spinner(`Installing skills for ${agent.name}...`);
      await sleep(200);
      mkdirSync(agent.skillsDir, { recursive: true });
      const dest = path2.join(agent.skillsDir, "remoteforge");
      if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
      try {
        cpSync(skillSrc, dest, { recursive: true });
        sp2.stop(success(`Skills installed to ${dest}`));
      } catch (e) {
        sp2.stop(fail(`Skill install failed: ${e.message}`));
      }
    } else {
      console.log(warn(`Skill source not found: ${skillSrc}`));
    }
  }
  console.log();
  console.log(header("Next steps:"));
  console.log(`  ${color("1.", c.cyan)} Start the server:  ${color("REMOTE_FORGE_DB=./remoteforge.db node packages/server/dist/index.js", c.dim)}`);
  console.log(`  ${color("2.", c.cyan)} Bootstrap admin:   ${color("remoteforge bootstrap -u admin -p <password>", c.dim)}`);
  console.log(`  ${color("3.", c.cyan)} Pair a VPS:        ${color("npx remote-forge-cli agent pair --server <url> --name myvps", c.dim)}`);
  console.log(`  ${color("4.", c.cyan)} Request a session via your agent's ${color("remoteforge_request_session", c.yellow)} tool`);
  console.log(`  ${color("5.", c.cyan)} Approve in dashboard/CLI, then claim the session token`);
  console.log();
  console.log(success("Setup complete! Restart your AI agent to load the new MCP server."));
  console.log();
}

// ../cli/src/index.ts
import { spawn } from "node:child_process";
import path3 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
import fs from "node:fs";
var __dirname2 = path3.dirname(fileURLToPath2(import.meta.url));
var program = new Command();
program.name("remoteforge").description("RemoteForge CLI").version("0.1.4");
program.command("setup").description("Interactive setup: configure your AI coding agent for RemoteForge").action(async () => {
  await runSetup();
});
program.command("agent").description("Run the RemoteForge VPS agent (pair, run, status)").allowUnknownOption(true).argument("[args...]").action((args) => {
  const agentCandidates = [
    path3.resolve(__dirname2, "agent.js"),
    path3.resolve(__dirname2, "..", "agent", "dist", "index.js"),
    path3.resolve(process.cwd(), "packages", "agent", "dist", "index.js")
  ];
  const agentPath = agentCandidates.find((p) => {
    try {
      fs.accessSync(p);
      return true;
    } catch {
      return false;
    }
  });
  if (!agentPath) {
    console.error("Agent binary not found. Run from repo root or install the full package.");
    process.exit(1);
  }
  const child = spawn("node", [agentPath, ...args], { stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 0));
});
program.command("config").description("Show CLI config").action(async () => {
  const cfg = await loadConfig();
  console.log(JSON.stringify(cfg, null, 2));
});
program.command("bootstrap").description("Bootstrap the first admin user (only if no users exist)").requiredOption("-u, --username <username>", "admin username").requiredOption("-p, --password <password>", "admin password").option("-s, --server <url>", "server url").action(async (opts) => {
  const cfg = await loadConfig();
  const url = opts.server ?? cfg.serverUrl;
  const client = new CliClient(url);
  const res = await client.request("POST", "/api/auth/bootstrap", { username: opts.username, password: opts.password });
  cfg.serverUrl = url;
  cfg.token = res.token;
  cfg.username = res.username;
  await saveConfig(cfg);
  console.log("Bootstrapped admin:", res.username);
  console.log("Token saved.");
});
program.command("login").description("Login as admin").requiredOption("-u, --username <username>", "username").requiredOption("-p, --password <password>", "password").option("-s, --server <url>", "server url").action(async (opts) => {
  const cfg = await loadConfig();
  const url = opts.server ?? cfg.serverUrl;
  const client = new CliClient(url);
  const res = await client.request("POST", "/api/auth/login", { username: opts.username, password: opts.password });
  cfg.serverUrl = url;
  cfg.token = res.token;
  cfg.username = res.username;
  await saveConfig(cfg);
  console.log("Logged in as", res.username);
});
function authedClient(cfg) {
  return new CliClient(cfg.serverUrl, cfg.token);
}
program.command("pairings").description("List pending pairings").action(async () => {
  const cfg = await loadConfig();
  const client = authedClient(cfg);
  const res = await client.request("GET", "/api/pairing");
  console.log(JSON.stringify(res.items, null, 2));
});
program.command("pairing-approve <id>").description("Approve a pairing request").action(async (id) => {
  const cfg = await loadConfig();
  const client = authedClient(cfg);
  const res = await client.request("POST", `/api/pairing/${id}/approve`, {});
  console.log("Approved. Node:", JSON.stringify(res.node, null, 2));
});
program.command("pairing-reject <id>").description("Reject a pairing request").action(async (id) => {
  const cfg = await loadConfig();
  const client = authedClient(cfg);
  await client.request("POST", `/api/pairing/${id}/reject`, {});
  console.log("Rejected.");
});
program.command("nodes").description("List VPS nodes").action(async () => {
  const cfg = await loadConfig();
  const client = authedClient(cfg);
  const res = await client.request("GET", "/api/nodes");
  console.log(JSON.stringify(res.items, null, 2));
});
program.command("node-revoke <id>").description("Revoke a VPS node").action(async (id) => {
  const cfg = await loadConfig();
  const client = authedClient(cfg);
  await client.request("POST", `/api/nodes/${id}/revoke`, {});
  console.log("Revoked node", id);
});
program.command("sessions").description("List sessions").option("-s, --status <status>", "filter by status").action(async (opts) => {
  const cfg = await loadConfig();
  const client = authedClient(cfg);
  const qs = opts.status ? `?status=${encodeURIComponent(opts.status)}` : "";
  const res = await client.request("GET", `/api/sessions${qs}`);
  console.log(JSON.stringify(res.items, null, 2));
});
program.command("session-approve <id>").description("Approve a session request").requiredOption("--scopes <scopes>", "comma-separated scopes").action(async (id, opts) => {
  const cfg = await loadConfig();
  const client = authedClient(cfg);
  const scopes = opts.scopes.split(",").map((s) => s.trim());
  const res = await client.request("POST", `/api/sessions/${id}/approve`, { approvedScopes: scopes });
  console.log("Approved. Session:", JSON.stringify(res.session, null, 2));
  console.log("Agent must claim with session secret to receive token.");
});
program.command("session-reject <id>").description("Reject a session request").action(async (id) => {
  const cfg = await loadConfig();
  const client = authedClient(cfg);
  await client.request("POST", `/api/sessions/${id}/reject`, {});
  console.log("Rejected.");
});
program.command("session-revoke <id>").description("Revoke a session").action(async (id) => {
  const cfg = await loadConfig();
  const client = authedClient(cfg);
  await client.request("POST", `/api/sessions/${id}/revoke`, {});
  console.log("Revoked.");
});
program.command("audit").description("Show audit log").option("-n, --limit <n>", "limit", "50").action(async (opts) => {
  const cfg = await loadConfig();
  const client = authedClient(cfg);
  const res = await client.request("GET", `/api/audit?limit=${opts.limit}`);
  console.log(JSON.stringify(res.items, null, 2));
});
program.parseAsync(process.argv).catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
