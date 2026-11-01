// Domain types shared across RemoteForge components.

export type ID = string;

export type Timestamp = number; // epoch millis

export const SCOPES = [
  "workspace:create",
  "workspace:read",
  "workspace:write",
  "command:run",
  "process:manage",
  "build:run",
  "artifact:read",
  "terminal:open",
] as const;

export type Scope = (typeof SCOPES)[number];

export type CredentialKind = "admin" | "node" | "session";

export interface Credential {
  id: ID;
  kind: CredentialKind;
  /** SHA-256 hex of the raw token. Raw token is never persisted. */
  tokenHash: string;
  /** Optional owning entity id (user/node/session). */
  ownerId: ID | null;
  scopes: Scope[];
  createdAt: Timestamp;
  expiresAt: Timestamp | null;
  revokedAt: Timestamp | null;
  lastUsedAt: Timestamp | null;
}

export interface User {
  id: ID;
  username: string;
  /** argon2/bcrypt hash of password. Phase 1 uses scrypt via node crypto. */
  passwordHash: string;
  createdAt: Timestamp;
}

export interface VpsNode {
  id: ID;
  name: string;
  hostname: string | null;
  os: string | null;
  arch: string | null;
  agentVersion: string | null;
  status: "pending" | "paired" | "online" | "offline" | "revoked";
  createdAt: Timestamp;
  lastHeartbeatAt: Timestamp | null;
  revokedAt: Timestamp | null;
}

export type PairingStatus = "pending" | "approved" | "rejected" | "expired" | "consumed";

export interface PairingRequest {
  id: ID;
  nodeId: ID | null;
  code: string;
  status: PairingStatus;
  metadata: Record<string, unknown>;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  approvedAt: Timestamp | null;
  approvedBy: ID | null;
}

export type SessionStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "active"
  | "expired"
  | "revoked"
  | "completed";

export interface SessionRequest {
  id: ID;
  agentIdentity: string;
  projectName: string | null;
  requestedScopes: Scope[];
  approvedScopes: Scope[] | null;
  nodeId: ID | null;
  status: SessionStatus;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  approvedAt: Timestamp | null;
  approvedBy: ID | null;
  credentialId: ID | null;
}

export interface AuditEvent {
  id: ID;
  actorType: "user" | "agent" | "system" | "anonymous";
  actorId: ID | null;
  action: string;
  targetType: string | null;
  targetId: ID | null;
  metadata: Record<string, unknown>;
  createdAt: Timestamp;
}

export interface RateLimitBucket {
  key: string;
  windowStart: Timestamp;
  count: number;
}

// Phase 2+ types
export type WorkspaceStatus = "pending" | "ready" | "destroying" | "destroyed" | "error";

export interface Workspace {
  id: ID;
  nodeId: ID;
  name: string;
  path: string | null;
  status: WorkspaceStatus;
  createdAt: Timestamp;
  destroyedAt: Timestamp | null;
  metadata: Record<string, unknown>;
}

export type JobType =
  | "create_workspace"
  | "destroy_workspace"
  | "list_files"
  | "read_file"
  | "write_file"
  | "run_command"
  | "install_dependencies"
  | "start_process"
  | "stop_process"
  | "get_process_status"
  | "build"
  | "collect_artifacts"
  | "upload_project"
  | "download_project";

export type JobStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled" | "timeout";

export interface Job {
  id: ID;
  nodeId: ID;
  workspaceId: ID | null;
  type: JobType;
  payload: Record<string, unknown>;
  status: JobStatus;
  result: Record<string, unknown> | null;
  logs: string;
  exitCode: number | null;
  createdAt: Timestamp;
  startedAt: Timestamp | null;
  finishedAt: Timestamp | null;
  timeoutMs: number | null;
  requestedBy: ID | null;
}

export interface ProcessInfo {
  id: ID;
  nodeId: ID;
  workspaceId: ID | null;
  pid: number | null;
  command: string;
  status: "running" | "stopped" | "exited" | "error";
  startedAt: Timestamp;
  stoppedAt: Timestamp | null;
  exitCode: number | null;
}

export interface UploadInfo {
  id: ID;
  workspaceId: ID | null;
  filename: string;
  size: number;
  createdAt: Timestamp;
}

export interface ArtifactInfo {
  id: ID;
  workspaceId: ID | null;
  nodeId: ID | null;
  filename: string;
  size: number;
  createdAt: Timestamp;
}

// Phase 3: build profiles
export interface BuildProfile {
  name: string;
  description: string;
  image: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  crossCompile?: boolean;
  notes?: string;
}