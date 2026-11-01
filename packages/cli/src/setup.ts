import * as readline from "node:readline";
import { mkdirSync, writeFileSync, existsSync, readFileSync, cpSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const AGENTS = [
  { key: "opencode", name: "OpenCode", configPath: path.join(os.homedir(), ".config", "opencode", "opencode.json"), skillsDir: path.join(os.homedir(), ".config", "opencode", "skills") },
  { key: "codex", name: "Codex", configPath: path.join(os.homedir(), ".codex", "config.toml"), skillsDir: path.join(os.homedir(), ".codex", "skills") },
  { key: "claude", name: "Claude Code", configPath: path.join(os.homedir(), ".claude", "settings.json"), skillsDir: path.join(os.homedir(), ".claude", "skills") },
  { key: "cursor", name: "Cursor", configPath: path.join(os.homedir(), ".cursor", "mcp.json"), skillsDir: null },
  { key: "windsurf", name: "Windsurf", configPath: path.join(os.homedir(), ".codeium", "windsurf", "mcp_config.json"), skillsDir: null },
  { key: "cline", name: "Cline", configPath: path.join(os.homedir(), ".cline", "mcp_settings.json"), skillsDir: null },
];

let rlInstance: readline.Interface | null = null;
function getRl() {
  if (!rlInstance) rlInstance = readline.createInterface({ input: process.stdin, output: process.stdout });
  return rlInstance;
}
// Read all input lines up front (works with piped stdin)
const inputLines: string[] = [];
let inputReady = false;
function initInput() {
  return new Promise<void>((resolve) => {
    const rl = readline.createInterface({ input: process.stdin });
    rl.on("line", (line) => inputLines.push(line));
    rl.on("close", () => { inputReady = true; resolve(); });
  });
}
let lineIndex = 0;
function ask(q: string): string {
  process.stdout.write(q);
  const ans = (lineIndex < inputLines.length) ? inputLines[lineIndex++] : "";
  return ans.trim();
}
// close at end
function closeRl() { if (rlInstance) { rlInstance.close(); rlInstance = null; } }

export async function runSetup() {
  await initInput();
  console.log("\n=== RemoteForge Setup ===\n");
  console.log("Which AI coding agent are you using?\n");
  AGENTS.forEach((a, i) => console.log(`  ${i + 1}. ${a.name}`));
  console.log(`  ${AGENTS.length + 1}. Other / manual\n`);

  const choice = ask("Enter number: ");
  const idx = parseInt(choice, 10) - 1;
  const agent = (idx >= 0 && idx < AGENTS.length) ? AGENTS[idx] : null;

  const serverUrl = ask("RemoteForge server URL (default http://localhost:8787): ") || "http://localhost:8787";
  const token = ask("Session token (leave blank to configure later): ");

  const mcpCandidates = [
    path.resolve(__dirname, "mcp.js"),
    path.resolve(__dirname, "..", "mcp-server", "dist", "index.js"),
    path.resolve(process.cwd(), "packages", "mcp-server", "dist", "index.js"),
    path.resolve(process.cwd(), "packages", "remoteforge", "dist", "mcp.js"),
  ];
  const mcpPath = mcpCandidates.find((p) => existsSync(p)) || mcpCandidates[0];
  const mcpEntry = {
    command: "node",
    args: [mcpPath],
    env: {
      REMOTE_FORGE_SERVER: serverUrl,
      REMOTE_FORGE_TOKEN: token || "<paste-session-token-here>",
    },
  };

  if (agent) {
    mkdirSync(path.dirname(agent.configPath), { recursive: true });
    let cfg: any = {};
    if (existsSync(agent.configPath)) {
      try { cfg = JSON.parse(readFileSync(agent.configPath, "utf8")); } catch { cfg = {}; }
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
      // TOML-ish: write a simple config
      const toml = `# RemoteForge\n[mcp_servers.remoteforge]\ncommand = "node"\nargs = [${mcpEntry.args.map(a=>`"${a}"`).join(", ")}]\n\n[mcp_servers.remoteforge.env]\nREMOTE_FORGE_SERVER = "${serverUrl}"\nREMOTE_FORGE_TOKEN = "${token || "<paste-session-token-here>"}"\n`;
      writeFileSync(agent.configPath, toml);
      console.log(`\nWrote Codex config to ${agent.configPath}`);
    }

    if (agent.key !== "codex") {
      writeFileSync(agent.configPath, JSON.stringify(cfg, null, 2));
      console.log(`\nWrote MCP config to ${agent.configPath}`);
    }

    // Install skills
    if (agent.skillsDir) {
      const skillCandidates = [
        path.resolve(__dirname, "..", "skills", agent.key === "claude" ? "claude-code" : agent.key),
        path.resolve(process.cwd(), "skills", agent.key === "claude" ? "claude-code" : agent.key),
      ];
      const skillSrc = skillCandidates.find((p) => existsSync(p)) || skillCandidates[0];
      if (existsSync(skillSrc)) {
        mkdirSync(agent.skillsDir, { recursive: true });
        try { cpSync(skillSrc, path.join(agent.skillsDir, "remoteforge"), { recursive: true }); console.log(`Installed skills to ${agent.skillsDir}`); } catch (e) { console.log("Skill install skipped:", (e as Error).message); }
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