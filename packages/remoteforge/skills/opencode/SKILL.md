---
name: remoteforge-opencode
description: RemoteForge integration for OpenCode agents.
---

# RemoteForge for OpenCode

Configure MCP server in `opencode.json`:

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

Then use the `remoteforge_*` tools in OpenCode. See `docs/mcp-config.md`.