import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { mkdirSync, writeFileSync, existsSync, readFileSync, cpSync, rmSync } from "node:fs";
import * as readline from "node:readline";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ANSI colors
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgBlue: "\x1b[44m",
};

function color(text: string, ...codes: string[]) { return codes.join("") + text + c.reset; }
function success(text: string) { return color("✔ " + text, c.green, c.bold); }
function fail(text: string) { return color("✖ " + text, c.red, c.bold); }
function info(text: string) { return color("ℹ " + text, c.cyan); }
function warn(text: string) { return color("⚠ " + text, c.yellow); }
function header(text: string) { return color(text, c.bold, c.magenta); }

// Spinner
function spinner(text: string): { stop: (msg?: string) => void } {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  const interval = setInterval(() => {
    process.stdout.write(`\r${color(frames[i++ % frames.length], c.cyan)} ${text}`);
  }, 80);
  return {
    stop: (msg?: string) => {
      clearInterval(interval);
      process.stdout.write(`\r${" ".repeat(text.length + 4)}\r`);
      if (msg) console.log(msg);
    },
  };
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

const AGENTS = [
  { key: "opencode", name: "OpenCode", configPath: path.join(os.homedir(), ".config", "opencode", "opencode.json"), skillsDir: path.join(os.homedir(), ".config", "opencode", "skills"), skillFolder: "opencode" },
  { key: "codex", name: "Codex", configPath: path.join(os.homedir(), ".codex", "config.toml"), skillsDir: path.join(os.homedir(), ".codex", "skills"), skillFolder: "codex" },
  { key: "claude", name: "Claude Code", configPath: path.join(os.homedir(), ".claude", "settings.json"), skillsDir: path.join(os.homedir(), ".claude", "skills"), skillFolder: "claude-code" },
  { key: "cursor", name: "Cursor", configPath: path.join(os.homedir(), ".cursor", "mcp.json"), skillsDir: null, skillFolder: null },
  { key: "windsurf", name: "Windsurf", configPath: path.join(os.homedir(), ".codeium", "windsurf", "mcp_config.json"), skillsDir: null, skillFolder: null },
  { key: "cline", name: "Cline", configPath: path.join(os.homedir(), ".cline", "mcp_settings.json"), skillsDir: null, skillFolder: null },
];

// Detect installed agents
function detectAgents(): typeof AGENTS {
  return AGENTS.filter((a) => existsSync(path.dirname(a.configPath)));
}

// Read all input lines up front
const inputLines: string[] = [];
function initInput() {
  return new Promise<void>((resolve) => {
    const rl = readline.createInterface({ input: process.stdin });
    rl.on("line", (line: string) => inputLines.push(line));
    rl.on("close", () => resolve());
  });
}
let lineIndex = 0;
function ask(q: string): string {
  process.stdout.write(q);
  const ans = lineIndex < inputLines.length ? inputLines[lineIndex++] : "";
  return ans.trim();
}

function resolveMcpPath(): string {
  const candidates = [
    path.resolve(__dirname, "mcp.js"),
    path.resolve(__dirname, "..", "mcp-server", "dist", "index.js"),
    path.resolve(process.cwd(), "packages", "mcp-server", "dist", "index.js"),
    path.resolve(process.cwd(), "packages", "remoteforge", "mcp.js"),
  ];
  return candidates.find((p) => existsSync(p)) || candidates[0];
}

function resolveSkillSrc(folder: string): string {
  const candidates = [
    path.resolve(__dirname, "..", "skills", folder),
    path.resolve(process.cwd(), "skills", folder),
  ];
  return candidates.find((p) => existsSync(p)) || candidates[0];
}

export async function runSetup() {
  await initInput();

  console.log();
  console.log(color("╔══════════════════════════════════════╗", c.magenta, c.bold));
  console.log(color("║     RemoteForge Interactive Setup     ║", c.magenta, c.bold));
  console.log(color("╚══════════════════════════════════════╝", c.magenta, c.bold));
  console.log();

  // Detect installed agents
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
  console.log(`  ${color(String(AGENTS.length + 1), c.cyan, c.bold)}. Other / manual\n`);

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
      REMOTE_FORGE_TOKEN: token || "<paste-session-token-here>",
    },
  };

  mkdirSync(path.dirname(agent.configPath), { recursive: true });
  let cfg: any = {};
  if (existsSync(agent.configPath)) {
    try { cfg = JSON.parse(readFileSync(agent.configPath, "utf8")); } catch { cfg = {}; }
  }

  if (agent.key === "codex") {
    const toml = `# RemoteForge\n[mcp_servers.remoteforge]\ncommand = "node"\nargs = [${mcpEntry.args.map((a) => `"${a}"`).join(", ")}]\n\n[mcp_servers.remoteforge.env]\nREMOTE_FORGE_SERVER = "${serverUrl}"\nREMOTE_FORGE_TOKEN = "${token || "<paste-session-token-here>"}"\n`;
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

  // Install skills
  if (agent.skillsDir && agent.skillFolder) {
    const skillSrc = resolveSkillSrc(agent.skillFolder === "claude-code" ? "claude-code" : agent.skillFolder);
    if (existsSync(skillSrc)) {
      const sp2 = spinner(`Installing skills for ${agent.name}...`);
      await sleep(200);
      mkdirSync(agent.skillsDir, { recursive: true });
      const dest = path.join(agent.skillsDir, "remoteforge");
      if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
      try {
        cpSync(skillSrc, dest, { recursive: true });
        sp2.stop(success(`Skills installed to ${dest}`));
      } catch (e) {
        sp2.stop(fail(`Skill install failed: ${(e as Error).message}`));
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