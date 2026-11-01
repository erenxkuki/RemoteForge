# RemoteForge for Codex

Codex agents can use RemoteForge via the MCP server.

## Setup
Add to your Codex MCP configuration:

```toml
[mcp_servers.remoteforge]
command = "node"
args = ["/path/to/RemoteForge/packages/mcp-server/dist/index.js"]

[mcp_servers.remoteforge.env]
REMOTE_FORGE_SERVER = "http://your-server:8787"
REMOTE_FORGE_TOKEN = "<session-token>"
```

## Usage
Use the `remoteforge_*` tools to manage remote workspaces, files, commands, builds, and artifacts.