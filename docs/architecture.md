# RemoteForge Architecture

## Overview

RemoteForge is a modular, AI-native remote development platform. It separates concerns
across independent components that communicate over a well-defined HTTP API and a
secure, scoped credential system.

## Components

1. **RemoteForge Server** (`packages/server`) - Central API, authorization, persistence,
   audit logging, rate limiting. Owns all durable state.
2. **RemoteForge Agent** (`packages/agent`) - Lightweight daemon installed on a VPS.
   Pairs with the server, heartbeats, and (in later phases) executes scoped workloads
   inside isolated containers.
3. **RemoteForge CLI** (`packages/cli`) - Operator/developer interface for pairing,
   managing sessions, and inspecting state.
4. **RemoteForge Dashboard** (Phase 5) - Browser UI.
5. **RemoteForge MCP Server** (Phase 4) - MCP tools for AI agents.
6. **RemoteForge Skills** (Phase 4) - Reusable agent instructions.

## Shared package

`packages/shared` contains types, crypto helpers, validation schemas, and protocol
definitions used by every component. It is the single source of truth for the wire
format and domain model.

## Communication

- All components talk to the Server over HTTPS (HTTP in dev).
- The Agent opens an outbound connection to the Server (no inbound ports required
  on the VPS beyond what the operator chooses). This is critical for firewalled VPS.
- Credentials are short-lived, scoped, revocable opaque tokens. The raw token is
  shown once at issuance; only a SHA-256 hash is persisted.
- Pairing uses a one-time, short-lived pairing code entered by the operator.

## Data flow (Phase 1)

1. Operator starts the Server.
2. Operator runs `agent pair` on the VPS (or locally for dev). The Agent calls
   `POST /api/pairing/initiate` with its public metadata and receives a
   `pairingCode` + `pairingId`.
3. Operator approves the pairing in the Dashboard/CLI: `POST /api/pairing/:id/approve`.
4. Server issues a scoped, long-lived (but revocable) **node credential** to the
   Agent. The Agent stores it locally (file mode 0600).
5. Agent heartbeats with `POST /api/agent/heartbeat` using the node credential.
6. AI agent (later via MCP) calls `POST /api/sessions/request` to request a
   remote execution session, declaring scopes and project metadata.
7. Operator reviews and approves/rejects via `POST /api/sessions/:id/approve`.
8. On approval Server issues a short-lived **session credential** scoped to the
   approved permissions. The AI agent uses it for all subsequent operations.
9. Session credential expires automatically; can be revoked at any time.

## Isolation (Phase 3+)

All project execution happens inside Docker containers with CPU/memory/disk/time
limits. The Agent never runs project code directly on the host. Phase 1 only
establishes trust + identity; no code execution yet.

## Persistence

SQLite (better-sqlite3) for Phase 1. Tables: users, vps_nodes, pairing_requests,
sessions, credentials, audit_events, rate_limit_buckets.

## Security principles

See `docs/security-model.md`.