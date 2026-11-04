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
  async request(method, path3, body) {
    const url = this.serverUrl.replace(/\/$/, "") + path3;
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
import * as readline from "node:readline";
import { mkdirSync, writeFileSync, existsSync, readFileSync, cpSync } from "node:fs";
import path2 from "node:path";
import { fileURLToPath } from "node:url";
import os2 from "node:os";
var __dirname = path2.dirname(fileURLToPath(import.meta.url));
var AGENTS = [
  { key: "opencode", name: "OpenCode", configPath: path2.join(os2.homedir(), ".config", "opencode", "opencode.json"), skillsDir: path2.join(os2.homedir(), ".config", "opencode", "skills") },
  { key: "codex", name: "Codex", configPath: path2.join(os2.homedir(), ".codex", "config.toml"), skillsDir: path2.join(os2.homedir(), ".codex", "skills") },
  { key: "claude", name: "Claude Code", configPath: path2.join(os2.homedir(), ".claude", "settings.json"), skillsDir: path2.join(os2.homedir(), ".claude", "skills") },
  { key: "cursor", name: "Cursor", configPath: path2.join(os2.homedir(), ".cursor", "mcp.json"), skillsDir: null },
  { key: "windsurf", name: "Windsurf", configPath: path2.join(os2.homedir(), ".codeium", "windsurf", "mcp_config.json"), skillsDir: null },
  { key: "cline", name: "Cline", configPath: path2.join(os2.homedir(), ".cline", "mcp_settings.json"), skillsDir: null }
];
var rlInstance = null;
var inputLines = [];
var inputReady = false;
function initInput() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin });
    rl.on("line", (line) => inputLines.push(line));
    rl.on("close", () => {
      inputReady = true;
      resolve();
    });
  });
}
var lineIndex = 0;
function ask(q) {
  process.stdout.write(q);
  const ans = lineIndex < inputLines.length ? inputLines[lineIndex++] : "";
  return ans.trim();
}
function closeRl() {
  if (rlInstance) {
    rlInstance.close();
    rlInstance = null;
  }
}
async function runSetup() {
  await initInput();
  console.log("\n=== RemoteForge Setup ===\n");
  console.log("Which AI coding agent are you using?\n");
  AGENTS.forEach((a, i) => console.log(`  ${i + 1}. ${a.name}`));
  console.log(`  ${AGENTS.length + 1}. Other / manual
`);
  const choice = ask("Enter number: ");
  const idx = parseInt(choice, 10) - 1;
  const agent = idx >= 0 && idx < AGENTS.length ? AGENTS[idx] : null;
  const serverUrl = ask("RemoteForge server URL (default http://localhost:8787): ") || "http://localhost:8787";
  const token = ask("Session token (leave blank to configure later): ");
  const mcpCandidates = [
    path2.resolve(__dirname, "mcp.js"),
    path2.resolve(__dirname, "..", "mcp-server", "dist", "index.js"),
    path2.resolve(process.cwd(), "packages", "mcp-server", "dist", "index.js"),
    path2.resolve(process.cwd(), "packages", "remoteforge", "dist", "mcp.js")
  ];
  const mcpPath = mcpCandidates.find((p) => existsSync(p)) || mcpCandidates[0];
  const mcpEntry = {
    command: "node",
    args: [mcpPath],
    env: {
      REMOTE_FORGE_SERVER: serverUrl,
      REMOTE_FORGE_TOKEN: token || "<paste-session-token-here>"
    }
  };
  if (agent) {
    mkdirSync(path2.dirname(agent.configPath), { recursive: true });
    let cfg = {};
    if (existsSync(agent.configPath)) {
      try {
        cfg = JSON.parse(readFileSync(agent.configPath, "utf8"));
      } catch {
        cfg = {};
      }
    }
    if (agent.key === "opencode") {
      cfg.mcp = cfg.mcp || {};
      cfg.mcp.servers = cfg.mcp.servers || {};
      cfg.mcp.servers.remoteforge = mcpEntry;
    } else if (agent.key === "claude") {
      cfg.mcpServers = cfg.mcpServers || {};
      cfg.mcpServers.remoteforge = mcpEntry;
    } else if (agent.key === "cursor" || agent.key === "windsurf" || agent.key === "cline") {
      cfg.mcpServers = cfg.mcpServers || {};
      cfg.mcpServers.remoteforge = mcpEntry;
    } else if (agent.key === "codex") {
      const toml = `# RemoteForge
[mcp_servers.remoteforge]
command = "node"
args = [${mcpEntry.args.map((a) => `"${a}"`).join(", ")}]

[mcp_servers.remoteforge.env]
REMOTE_FORGE_SERVER = "${serverUrl}"
REMOTE_FORGE_TOKEN = "${token || "<paste-session-token-here>"}"
`;
      writeFileSync(agent.configPath, toml);
      console.log(`
Wrote Codex config to ${agent.configPath}`);
    }
    if (agent.key !== "codex") {
      writeFileSync(agent.configPath, JSON.stringify(cfg, null, 2));
      console.log(`
Wrote MCP config to ${agent.configPath}`);
    }
    if (agent.skillsDir) {
      const skillCandidates = [
        path2.resolve(__dirname, "..", "skills", agent.key === "claude" ? "claude-code" : agent.key),
        path2.resolve(process.cwd(), "skills", agent.key === "claude" ? "claude-code" : agent.key)
      ];
      const skillSrc = skillCandidates.find((p) => existsSync(p)) || skillCandidates[0];
      if (existsSync(skillSrc)) {
        mkdirSync(agent.skillsDir, { recursive: true });
        try {
          cpSync(skillSrc, path2.join(agent.skillsDir, "remoteforge"), { recursive: true });
          console.log(`Installed skills to ${agent.skillsDir}`);
        } catch (e) {
          console.log("Skill install skipped:", e.message);
        }
      }
    }
  } else {
    console.log("\nManual setup: see docs/mcp-config.md");
  }
  console.log("\nNext steps:");
  console.log("  1. Start the server:  REMOTE_FORGE_DB=./remoteforge.db node packages/server/dist/index.js");
  console.log("  2. Bootstrap admin:   remoteforge bootstrap -u admin -p <password>");
  console.log("  3. Pair a VPS:        remoteforge-agent pair --server <url> --name myvps");
  console.log("  4. Request a session via your agent's remoteforge_request_session tool");
  console.log("  5. Approve in dashboard/CLI, then claim the session token");
  closeRl();
  console.log("\nDone!\n");
}

// ../cli/src/index.ts
var program = new Command();
program.name("remoteforge").description("RemoteForge CLI").version("0.1.4");
program.command("setup").description("Interactive setup: configure your AI coding agent for RemoteForge").action(async () => {
  await runSetup();
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
