# RemoteForge Security Model

## Trust boundaries

- **Operator (human)**: owns the Server, approves pairings and sessions, holds
  admin credentials.
- **VPS Agent**: trusted to run on the operator's VPS. Holds a revocable node
  credential. Never receives end-user project code execution privileges beyond
  what the session grants.
- **AI Agent**: untrusted. Receives only short-lived, scoped session credentials
  after explicit human approval. Never receives SSH keys or permanent creds.
- **Server**: single source of truth for identity, authorization, audit.

## Credentials

- All credentials are opaque random tokens (256 bits, base64url).
- Only a SHA-256 hash is persisted. The raw token is returned exactly once.
- Node credentials: long-lived but revocable; scoped to a single VPS node.
- Session credentials: short-lived (default 1h, max 24h); scoped to a workspace
  and a set of permission scopes; revocable instantly.
- Admin/operator credentials: issued at server bootstrap; rotatable.

## Pairing

- Pairing is initiated by the Agent. The Server returns a short-lived pairing
  code (6 alphanumeric, ~10 min TTL) and a pairing ID.
- The code is displayed to the operator out-of-band (terminal / dashboard).
- Approval requires an authenticated operator session.
- On approval, the Server issues a node credential bound to that node's identity.
- Pairing codes are single-use and expire.

## Session requests

- An AI agent (or any client) submits a session request with: requested scopes,
  project name, agent identity, optional metadata.
- The request is `pending` until an operator approves or rejects.
- Requests expire after a configurable TTL (default 10 min).
- Approval issues a session credential with exactly the approved scopes (operator
  may reduce scopes).
- Rejection is final; a new request must be created.

## Scopes

`workspace:create`, `workspace:read`, `workspace:write`, `command:run`,
`process:manage`, `build:run`, `artifact:read`, `terminal:open`.
Phase 1 models scopes; enforcement of each lands with its feature phase.

## Protections

- Rate limiting per IP and per credential on all endpoints.
- Input validation with zod on every request.
- Path traversal protection (Phase 2) on all file operations.
- Command injection protection: structured command + args, never shell strings
  (Phase 2).
- Audit log for every privileged operation (pairing, approval, revocation,
  session lifecycle).
- Emergency revocation: `POST /api/sessions/:id/revoke` and
  `POST /api/nodes/:id/revoke` immediately invalidate credentials.
- No secrets in logs; tokens are redacted.

## What is NOT in Phase 1

- Code execution, file transfer, builds, MCP, dashboard. These are later phases
  and will layer on top of this identity/authorization foundation.