# RemoteForge

AI-native remote development & execution platform.

Phases 1-6 implemented: core daemon + pairing + sessions, workspace management,
file transfer, remote command execution, process management, Docker-based
isolated builds with cross-compilation, MCP server, interactive terminal
dashboard, and multi-agent/multi-VPS support via scoped credentials.

## Structure

- `packages/shared` - types, crypto, validation, protocol
- `packages/server` - central API + authorization + audit + rate limiting
- `packages/agent` - VPS daemon (pairing + heartbeat)
- `packages/cli` - operator CLI

## Setup

```sh
npm install --ignore-scripts
npm run build
```

## Run server

```sh
REMOTE_FORGE_DB=./remoteforge.db node packages/server/dist/index.js
# or
npm run start --workspace packages/server
```

Default port 8787.

## Bootstrap admin

```sh
node packages/cli/dist/index.js bootstrap -u admin -p password123
```

## Pair a VPS

On the VPS (or locally for dev):

```sh
node packages/agent/dist/index.js pair --server http://<server>:8787 --name myvps
```

The agent prints a pairing code. In the dashboard/CLI, approve:

```sh
node packages/cli/dist/index.js pairings
node packages/cli/dist/index.js pairing-approve <pairingId>
```

The agent then claims its node credential automatically and starts heartbeating:

```sh
node packages/agent/dist/index.js run
```

## Session request flow (AI agent)

```sh
curl -X POST http://server:8787/api/sessions/request -H 'Content-Type: application/json' \
  -d '{"agentIdentity":"my-agent","projectName":"demo","requestedScopes":["workspace:read","command:run"]}'
```

Operator approves:

```sh
node packages/cli/dist/index.js sessions
node packages/cli/dist/index.js session-approve <sessionId> --scopes workspace:read,command:run
```

## Tests

```sh
npm run test --workspace packages/server
```

## Security

See `docs/security-model.md`. Tokens are stored only as SHA-256 hashes;
raw tokens are returned once. Node and session credentials are scoped and
revocable. All privileged actions are audit-logged.

## License

MIT