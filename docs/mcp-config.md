# MCP Configuration

RemoteForge MCP server communicates over stdio.

## OpenCode

Add to `opencode.json`:

```json
{
  "mcp": {
    "servers": {
      "remoteforge": {
        "command": "node",
        "args": ["/path/to/RemoteForge/packages/mcp-server/dist/index.js"],
        "env": {
          "REMOTE_FORGE_SERVER": "http://your-server:8787",
          "REMOTE_FORGE_TOKEN": "<session-token-after-claim>"
        }
      }
    }
  }
}
```

## Other MCP clients

Use command `node /path/to/.../dist/index.js` with env vars above.

## Workflow

1. Request session (tool: remoteforge_request_session) → get sessionId + sessionSecret.
2. Human approves in dashboard/CLI.
3. Claim session (tool: remoteforge_claim_session) → token stored in server process.
4. Use workspace/file/command/build/artifact tools.