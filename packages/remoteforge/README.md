# remote-forge-cli

One-command setup for [RemoteForge](https://github.com/erenxkuki/RemoteForge) — the AI-native remote development & execution platform.

## Quick start

```bash
npx remote-forge-cli setup
```

The interactive wizard will ask:

1. Which AI coding agent you use (OpenCode, Codex, Claude Code, Cursor, Windsurf, Cline, or manual).
2. Your RemoteForge server URL.
3. Your session token (optional — can be added later).

It then writes the correct MCP configuration and installs the RemoteForge skills for your agent.

## What is RemoteForge?

RemoteForge lets your local AI coding agent run builds, tests, and commands on a remote VPS instead of your laptop. It provides:

- 🔐 Secure, scoped, revocable session credentials
- 🖥️ Remote workspaces with file sync
- ⚡ Remote command execution & process management
- 🐳 Docker-based isolated builds with cross-compilation
- 🤖 First-class MCP server for AI agents
- 🖥️ Interactive web terminal (xterm.js)

## After setup

1. Start the server:
   ```bash
   REMOTE_FORGE_DB=./remoteforge.db node packages/server/dist/index.js
   ```
2. Bootstrap an admin:
   ```bash
   remoteforge bootstrap -u admin -p <password>
   ```
3. Pair a VPS:
   ```bash
   remoteforge-agent pair --server <url> --name myvps
   ```
4. Request a session from your AI agent via `remoteforge_request_session`.
5. Approve in the dashboard/CLI, then claim the session token.

## Links

- Source: https://github.com/erenxkuki/RemoteForge
- Docs: https://github.com/erenxkuki/RemoteForge/tree/main/docs
- MCP config: https://github.com/erenxkuki/RemoteForge/blob/main/docs/mcp-config.md

## License

MIT