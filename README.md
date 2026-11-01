# 🚀 RemoteForge

> **AI-native remote development & execution platform**
> Run builds, tests, and commands on a VPS while your local AI agent stays in control.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node-24+-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue.svg)](https://www.typescriptlang.org)
[![Status](https://img.shields.io/badge/Status-Phases%201--6%20Complete-brightgreen.svg)]()

---

## ✨ Highlights

- 🔐 **Secure pairing** — SSHX-inspired session requests with scoped, short-lived, revocable credentials
- 🖥️ **Remote execution** — workspaces, file sync, commands, processes, builds, artifacts
- 🐳 **Docker builds** — isolated, resource-limited, cross-compilation-friendly
- 🤖 **MCP server** — first-class AI agent integration (OpenCode, Codex, Claude Code)
- 🖥️ **Interactive terminal** — xterm.js over WebSocket PTY
- 📊 **Web dashboard** — dark, minimal, developer-focused

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
| `skills/` | Agent skills (OpenCode, Codex, Claude Code, generic) |
| `docs/` | Architecture, security model, MCP config, agent skill |

---

## ⚡ Quick Start

### 1. Install
```bash
git clone https://github.com/erenxkuki/RemoteForge.git
cd RemoteForge
npm install --ignore-scripts
npm run build
```

### 2. Run the server
```bash
REMOTE_FORGE_DB=./remoteforge.db node packages/server/dist/index.js
```

### 3. Bootstrap admin
```bash
node packages/cli/dist/index.js bootstrap -u admin -p password123
node packages/cli/dist/index.js login -u admin -p password123
```

### 4. Pair a VPS
```bash
# On the VPS
node packages/agent/dist/index.js pair --server http://<server>:8787 --name myvps
# Approve from the server side
node packages/cli/dist/index.js pairings
node packages/cli/dist/index.js pairing-approve <pairingId>
# Start the daemon
node packages/agent/dist/index.js run
```

### 5. Open the dashboard
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

Skills are available under [`skills/`](skills/).

---

## 🧪 Tests

```bash
npm test            # all workspaces
npm run test --workspace packages/server   # server integration tests
```

---

## 📚 Documentation

- [Architecture](docs/architecture.md)
- [Security Model](docs/security-model.md)
- [MCP Config](docs/mcp-config.md)
- [Agent Skill](docs/agent-skill.md)

---

## 📄 License

MIT — see [LICENSE](LICENSE).