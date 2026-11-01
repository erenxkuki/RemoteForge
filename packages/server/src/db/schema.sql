CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vps_nodes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  hostname TEXT,
  os TEXT,
  arch TEXT,
  agent_version TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_heartbeat_at INTEGER,
  revoked_at INTEGER
);

CREATE TABLE IF NOT EXISTS pairing_requests (
  id TEXT PRIMARY KEY,
  node_id TEXT,
  code TEXT NOT NULL,
  status TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  approved_at INTEGER,
  approved_by TEXT,
  FOREIGN KEY (node_id) REFERENCES vps_nodes(id),
  FOREIGN KEY (approved_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  agent_identity TEXT NOT NULL,
  project_name TEXT,
  requested_scopes TEXT NOT NULL,
  approved_scopes TEXT,
  node_id TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  approved_at INTEGER,
  approved_by TEXT,
  credential_id TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (node_id) REFERENCES vps_nodes(id),
  FOREIGN KEY (approved_by) REFERENCES users(id),
  FOREIGN KEY (credential_id) REFERENCES credentials(id)
);

CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  owner_id TEXT,
  scopes TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  revoked_at INTEGER,
  last_used_at INTEGER
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (key, window_start)
);

-- Phase 2+ tables
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL,
  name TEXT NOT NULL,
  path TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  destroyed_at INTEGER,
  metadata TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (node_id) REFERENCES vps_nodes(id)
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL,
  workspace_id TEXT,
  type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL,
  result TEXT,
  logs TEXT NOT NULL DEFAULT '',
  exit_code INTEGER,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  timeout_ms INTEGER,
  requested_by TEXT,
  FOREIGN KEY (node_id) REFERENCES vps_nodes(id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE IF NOT EXISTS processes (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL,
  workspace_id TEXT,
  job_id TEXT,
  pid INTEGER,
  command TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  stopped_at INTEGER,
  exit_code INTEGER,
  FOREIGN KEY (node_id) REFERENCES vps_nodes(id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  filename TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  node_id TEXT,
  filename TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE INDEX IF NOT EXISTS idx_pairing_code ON pairing_requests(code);
CREATE INDEX IF NOT EXISTS idx_pairing_status ON pairing_requests(status);
CREATE INDEX IF NOT EXISTS idx_session_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_cred_hash ON credentials(token_hash);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_node_status ON jobs(node_id, status);
CREATE INDEX IF NOT EXISTS idx_workspaces_node ON workspaces(node_id);