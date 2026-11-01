---
name: remoteforge-claude-code
description: RemoteForge integration for Claude Code.
---

# RemoteForge for Claude Code

## Setup
Add the MCP server to Claude Code settings:

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

## Usage
Invoke RemoteForge tools to run builds and tests on a remote VPS. Follow the request → approve → claim → workspace → build workflow.