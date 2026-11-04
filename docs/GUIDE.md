# RemoteForge — Complete Start-to-End Guide

> AI-native remote development & execution platform.
> Run builds, tests, and commands on a VPS while your local AI agent stays in control.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Installation](#2-installation)
3. [Start the Server](#3-start-the-server)
4. [Bootstrap Admin Account](#4-bootstrap-admin-account)
5. [Connect a VPS (Agent Pairing)](#5-connect-a-vps-agent-pairing)
6. [Verify the VPS is Online](#6-verify-the-vps-is-online)
7. [Configure Your AI Agent (MCP)](#7-configure-your-ai-agent-mcp)
8. [Request & Approve a Session](#8-request--approve-a-session)
9. [Use RemoteForge Tools](#9-use-remoteforge-tools)
10. [Interactive Terminal](#10-interactive-terminal)
11. [Web Dashboard](#11-web-dashboard)
12. [Build Profiles](#12-build-profiles)
13. [Security & Audit](#13-security--audit)
14. [Troubleshooting](#14-troubleshooting)

---

## 1. Prerequisites

| Component | Requirement |
|---|---|
| Node.js | 20+ (24 recommended) |
| npm | 10+ |
| Git | any recent version |
| VPS | Linux recommended, Node.js 20+ |
| Docker (optional) | For isolated builds |

---

## 2. Installation

### Clone the repository
```bash
git clone https://github.com/erenxkuki/RemoteForge.git
cd RemoteForge
npm install --ignore-scripts
npm run build
```

### Or use npx (no clone needed for client setup)
```bash
npx remote-forge-cli setup
```

---

## 3. Start the Server

The server is the central API and authorization service.

### Local / Dev
```bash
# Linux/macOS
REMOTE_FORGE_DB=./remoteforge.db node packages/server/dist/index.js

# Windows (cmd)
set REMOTE_FORGE_DB=./remoteforge.db
node packages/server/dist/index.js

# Windows (PowerShell)
$env:REMOTE_FORGE_DB="./remoteforge.db"; node packages/server/dist/index.js
```

Default port: **8787**. Override with `PORT=9000`.

### Verify
```bash
curl http://localhost:8787/health
# {"ok":true,"version":"0.1.0"}
```

### Production (public VPS)
Run the server on a public VPS so your build VPS can reach it:
```bash
REMOTE_FORGE_DB=/var/lib/remoteforge/remoteforge.db node packages/server/dist/index.js
```
Use a reverse proxy (nginx/caddy) with HTTPS in production.

---

## 4. Bootstrap Admin Account

```bash
node packages/cli/dist/index.js bootstrap -u admin -p yourpassword
node packages/cli/dist/index.js login -u admin -p yourpassword
```

This creates the first admin user and saves the token to `~/.remoteforge/cli.json`.

---

## 5. Connect a VPS (Agent Pairing)

### On the VPS
```bash
# Option A: via npx (no clone needed)
npx remote-forge-cli agent pair --server http://YOUR_SERVER:8787 --name myvps

# Option B: from cloned repo
node packages/agent/dist/index.js pair --server http://YOUR_SERVER:8787 --name myvps
```

The agent prints:
```
Pairing code (give to operator): ABC123
Pairing secret (keep private): xyz...
Waiting for operator approval...
```

### On the server/control side — approve
```bash
node packages/cli/dist/index.js pairings              # list pending
node packages/cli/dist/index.js pairing-approve <pairingId>
```

The agent claims its credential automatically and starts heartbeating.

### Start the daemon (on VPS)
```bash
npx remote-forge-cli agent run
# or from repo:
node packages/agent/dist/index.js run
```

### One-line VPS installer
```bash
curl -fsSL https://raw.githubusercontent.com/erenxkuki/RemoteForge/main/packages/remoteforge/install.sh | bash
```

---

## 6. Verify the VPS is Online

```bash
node packages/cli/dist/index.js nodes
```
Expected output shows your node with status `online`.

---

## 7. Configure Your AI Agent (MCP)

### Automatic (recommended)
```bash
npx remote-forge-cli setup
```
Selects your agent, writes MCP config, installs skills.

### Manual — OpenCode
Add to `~/.config/opencode/opencode.json`:
```json
{
  "mcp": {
    "servers": {
      "remoteforge": {
        "command": "node",
        "args": ["/path/to/RemoteForge/packages/mcp-server/dist/index.js"],
        "env": {
          "REMOTE_FORGE_SERVER": "http://your-server:8787",
          "REMOTE_FORGE_TOKEN": "<session-token>"
        }
      }
    }
  }
}
```

### Manual — Claude Code
Add to `~/.claude/settings.json`:
```json
{
  "mcpServers": {
    "remoteforge": {
      "command": "node",
      "args": ["/path/to/RemoteForge/packages/mcp-server/dist/index.js"],
      "env": {
        "REMOTE_FORGE_SERVER": "http://your-server:8787",
        "REMOTE_FORGE_TOKEN": "<session-token>"
      }
    }
  }
}
```

### Manual — Codex
Add to `~/.codex/config.toml`:
```toml
[mcp_servers.remoteforge]
command = "node"
args = ["/path/to/RemoteForge/packages/mcp-server/dist/index.js"]

[mcp_servers.remoteforge.env]
REMOTE_FORGE_SERVER = "http://your-server:8787"
REMOTE_FORGE_TOKEN = "<session-token>"
```

---

## 8. Request & Approve a Session

### From your AI agent (MCP tool)
```
remoteforge_request_session(
  agentIdentity="my-agent",
  projectName="my-project",
  requestedScopes=["workspace:read", "workspace:write", "command:run", "build:run", "artifact:read"]
)
```
Returns: `sessionId` + `sessionSecret`.

### Approve (human)
```bash
node packages/cli/dist/index.js sessions
node packages/cli/dist/index.js session-approve <sessionId> --scopes workspace:read,workspace:write,command:run,build:run,artifact:read
```

### Claim token (AI agent)
```
remoteforge_claim_session(sessionId, sessionSecret)  →  receives token
```

The MCP server stores the token automatically for subsequent calls.

---

## 9. Use RemoteForge Tools

Once authenticated, your AI agent can:

| Tool | Description |
|---|---|
| `remoteforge_create_workspace` | Create a workspace on a VPS |
| `remoteforge_list_workspaces` | List workspaces |
| `remoteforge_destroy_workspace` | Destroy a workspace |
| `remoteforge_list_files` | List files in workspace |
| `remoteforge_read_file` | Read a file |
| `remoteforge_write_file` | Write a file (base64 content) |
| `remoteforge_run_command` | Run a command |
| `remoteforge_install_dependencies` | Install deps (npm/pip/cargo/etc.) |
| `remoteforge_start_process` | Start a background process |
| `remoteforge_stop_process` | Stop a process |
| `remoteforge_build` | Build with a profile |
| `remoteforge_list_artifacts` | List build artifacts |
| `remoteforge_download_artifact` | Download artifact (base64) |
| `remoteforge_session_status` | Check session status |

### Example: Build a Node.js project
```
1. remoteforge_create_workspace(nodeId, "my-app") → workspaceId
2. remoteforge_write_file(workspaceId, "package.json", <base64>)
3. remoteforge_write_file(workspaceId, "index.js", <base64>)
4. remoteforge_install_dependencies(workspaceId, "npm")
5. remoteforge_build(workspaceId, "node")
6. remoteforge_run_command(workspaceId, "node", ["index.js"])
7. remoteforge_list_artifacts(workspaceId)
```

---

## 10. Interactive Terminal

### Via dashboard
Open `packages/dashboard/index.html` → Terminal tab → Open session.

### Via WebSocket (programmatic)
```javascript
const ws = new WebSocket("ws://server:8787/ws/terminal/<sessionId>");
ws.send(JSON.stringify({ type: "open", nodeId, cols: 80, rows: 24 }));
ws.send(JSON.stringify({ type: "input", data: "ls -la\r\n" }));
ws.onmessage = (e) => console.log(JSON.parse(e.data));
```

---

## 11. Web Dashboard

Open `packages/dashboard/index.html` in any browser.

Sections:
- **Overview** — stats and quick links
- **VPS Nodes** — list, revoke
- **Pairing Requests** — approve/reject
- **Sessions** — approve/reject/revoke
- **Workspaces** — create, destroy
- **Jobs** — inspect job status/logs
- **Artifacts** — download builds
- **Audit Log** — all privileged actions
- **Terminal** — interactive xterm.js PTY

---

## 12. Build Profiles

| Profile | Image | Command | Cross-compile |
|---|---|---|---|
| `node` | node:22-alpine | npm run build | — |
| `python` | python:3.12-slim | python -m pytest | — |
| `rust` | rust:1.80-slim | cargo build --release | Via env |
| `go` | golang:1.23-alpine | go build ./... | GOOS/GOARCH |
| `cpp` | gcc:14 | make | — |
| `java` | maven:3.9-temurin-21 | mvn package | — |
| `android` | reactnativecommunity/react-native-android | gradlew assembleRelease | — |
| `.net` | dotnet/sdk:8.0 | dotnet build | — |

Custom profiles can be added to `packages/shared/src/buildProfiles.ts`.

List profiles: `GET /api/build-profiles`

---

## 13. Security & Audit

### Credentials
- Opaque 256-bit tokens, stored as SHA-256 hashes only.
- Node credentials: long-lived, revocable.
- Session credentials: short-lived (1h default, max 24h), scoped, revocable.

### Scopes
`workspace:create`, `workspace:read`, `workspace:write`, `command:run`, `process:manage`, `build:run`, `artifact:read`, `terminal:open`

### Audit
```bash
node packages/cli/dist/index.js audit
```

### Emergency revocation
```bash
node packages/cli/dist/index.js session-revoke <id>
node packages/cli/dist/index.js node-revoke <id>
```

### Protections
- Rate limiting (per IP + per credential)
- Input validation (zod on every request)
- Path traversal protection
- Command injection protection (structured args, no shell strings)
- Session request expiration (10 min)
- Pairing code expiration (10 min)

---

## 14. Troubleshooting

### Server won't start
- Check port: `PORT=9000 node packages/server/dist/index.js`
- Check DB path: `REMOTE_FORGE_DB=/tmp/rf.db node ...`

### Agent can't connect
- Ensure VPS can reach server URL (use public IP or tunnel).
- Check agent config: `node packages/agent/dist/index.js status`
- Check server logs for pairing errors.

### Build fails
- Check Docker is installed: `docker --version`
- Check job logs: `GET /api/jobs/:id` → `logs` field.
- Increase timeout: pass `timeoutMs` in build request.

### MCP tools not available
- Restart your AI agent after configuring MCP.
- Verify server URL and token in config.
- Test: `node packages/mcp-server/dist/index.js` (should hang waiting for stdio).

### Tests
```bash
npm test                          # all workspaces
npm run test --workspace packages/server  # server integration (6 tests)
```

---

## 📄 License

MIT — see [LICENSE](LICENSE).