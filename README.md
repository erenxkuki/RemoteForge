# 🚀 RemoteForge

> **AI-native remote development & execution platform**
> Run builds, tests, and commands on a VPS while your local AI agent stays in control.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node-20+-green.svg)](https://nodejs.org)
[![npm](https://img.shields.io/npm/v/remote-forge-cli.svg)](https://www.npmjs.com/package/remote-forge-cli)
[![Status](https://img.shields.io/badge/Status-Complete-brightgreen.svg)]()

---

## ✨ Highlights

- 🔐 **Secure pairing** — SSHX-inspired session requests with scoped, short-lived, revocable credentials
- 🖥️ **Remote execution** — workspaces, file sync, commands, processes, builds, artifacts
- 🐳 **Docker builds** — isolated, resource-limited, cross-compilation-friendly
- 🤖 **MCP server** — first-class AI agent integration (OpenCode, Codex, Claude Code)
- 🖥️ **Interactive terminal** — xterm.js over WebSocket PTY
- 📊 **Web dashboard** — dark, minimal, developer-focused
- ⚡ **One-line install** — for both client and VPS

---

## 📦 Architecture

```
┌────────────┐     HTTPS      ┌──────────────┐     WS/HTTP     ┌──────────────┐
│ AI Agent   │ ─────────────▶ │ RemoteForge  │ ◀────────────── │ VPS Agent    │
│ (MCP/CLI)  │                │ Server       │                 │ (daemon)     │
└────────────┘                └──────┬───────┘                 └──────┬───────┘
                                    │                                │
                                    ▼                                ▼
                              ┌──────────┐                    ┌──────────────┐
                              │ SQLite   │                    │ Docker       │
                              │ + Audit  │                    │ Workspaces   │
                              └──────────┘                    └──────────────┘
```

## 🗂️ Repository Layout

| Package | Description |
|---|---|
| `packages/shared` | Types, crypto, validation, build profiles |
| `packages/server` | Central API, auth, audit, rate limiting, WebSocket terminal |
| `packages/agent` | VPS daemon: pairing, heartbeat, job execution |
| `packages/cli` | Operator CLI |
| `packages/mcp-server` | MCP server for AI agents |
| `packages/dashboard` | Web dashboard (xterm.js) |
| `packages/remoteforge` | Self-contained npm package (npx-ready) |
| `skills/` | Agent skills (OpenCode, Codex, Claude Code, generic) |
| `docs/` | Architecture, security model, MCP config, guide |

---

## ⚡ Quick Start

### 1. Install (client/control machine)
```bash
git clone https://github.com/erenxkuki/RemoteForge.git
cd RemoteForge
npm install --ignore-scripts
npm run build
```

Or via npx (no clone):
```bash
npx remote-forge-cli setup
```

### 2. Start the server
```bash
# Linux/macOS
REMOTE_FORGE_DB=./remoteforge.db node packages/server/dist/index.js

# Windows (cmd)
set REMOTE_FORGE_DB=./remoteforge.db
node packages/server/dist/index.js
```

### 3. Bootstrap admin
```bash
node packages/cli/dist/index.js bootstrap -u admin -p yourpassword
node packages/cli/dist/index.js login -u admin -p yourpassword
```

### 4. Connect a VPS

**One-line installer (Linux):**
```bash
curl -fsSL https://raw.githubusercontent.com/erenxkuki/RemoteForge/main/packages/remoteforge/install.sh | bash
```

**One-line installer (Windows PowerShell):**
```powershell
irm https://raw.githubusercontent.com/erenxkuki/RemoteForge/main/packages/remoteforge/install.ps1 | iex
```

**Or via npx (no install needed):**
```bash
npx remote-forge-cli agent pair --server http://<server>:8787 --name myvps
# Approve from server side:
remoteforge pairings && remoteforge pairing-approve <id>
# Start daemon:
npx remote-forge-cli agent run
```

### 5. One-command agent setup (npx)
```bash
npx remote-forge-cli setup
```
Selects your agent, writes MCP config, installs skills.

### 6. Open the dashboard
Open `packages/dashboard/index.html` in a browser and connect with your server URL + token.

---

## 🔐 Security

- Scoped, revocable, short-lived credentials (node + session)
- No permanent VPS credentials exposed to AI agents
- Docker-isolated execution with CPU/memory/time limits
- Path traversal & command injection protection
- Full audit log + emergency revocation

See [`docs/security-model.md`](docs/security-model.md).

---

## 🤖 MCP Integration

See [`docs/mcp-config.md`](docs/mcp-config.md) for OpenCode / Codex / Claude Code setup.

Skills are available under [`skills/`](skills/) and installed via `npx remote-forge-cli setup`.

---

## 🧪 Tests

```bash
npm test                          # all workspaces
npm run test --workspace packages/server   # server integration (6 tests)
```

---

## 📚 Documentation

- [Complete Guide](docs/GUIDE.md)
- [Architecture](docs/architecture.md)
- [Security Model](docs/security-model.md)
- [MCP Config](docs/mcp-config.md)
- [Agent Skill](docs/agent-skill.md)

---

## 📄 License

MIT — see [LICENSE](LICENSE).