import { z } from "zod";
import { SCOPES } from "../types/index.js";

export const ScopeSchema = z.enum(SCOPES as unknown as [string, ...string[]]);

export const UsernameSchema = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[a-zA-Z0-9_.-]+$/);

export const PasswordSchema = z.string().min(8).max(256);

export const PairingInitiateSchema = z.object({
  name: z.string().min(1).max(128),
  hostname: z.string().max(256).optional(),
  os: z.string().max(64).optional(),
  arch: z.string().max(64).optional(),
  agentVersion: z.string().max(64).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const PairingApproveSchema = z.object({
  // operator may reduce scopes granted to the node; default all node scopes
  scopes: z.array(ScopeSchema).optional(),
});

export const SessionRequestSchema = z.object({
  agentIdentity: z.string().min(1).max(128),
  projectName: z.string().max(256).optional().nullable(),
  requestedScopes: z.array(ScopeSchema).min(1),
  nodeId: z.string().optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const SessionApproveSchema = z.object({
  approvedScopes: z.array(ScopeSchema).min(1),
});

export const LoginSchema = z.object({
  username: UsernameSchema,
  password: PasswordSchema,
});

export const BootstrapAdminSchema = z.object({
  username: UsernameSchema,
  password: PasswordSchema,
});

export const HeartbeatSchema = z.object({
  status: z.enum(["online", "degraded"]).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const PaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// Phase 2+
export const CreateWorkspaceSchema = z.object({
  nodeId: z.string(),
  name: z.string().min(1).max(128),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const RunCommandSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional().default([]),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  timeoutMs: z.number().int().min(1000).max(3600000).optional(),
});

export const WriteFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(), // base64 or utf8? we'll use base64
  encoding: z.enum(["utf8", "base64"]).optional().default("base64"),
});

export const ReadFileQuerySchema = z.object({
  path: z.string().min(1),
});

export const ListFilesQuerySchema = z.object({
  path: z.string().optional().default("."),
});

export const StartProcessSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional().default([]),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
});

export const InstallDepsSchema = z.object({
  manager: z.enum(["npm", "pip", "cargo", "go", "maven", "gradle", "dotnet", "custom"]).default("npm"),
  args: z.array(z.string()).optional().default([]),
});

export const BuildSchema = z.object({
  profile: z.string().min(1),
  command: z.string().optional(),
  args: z.array(z.string()).optional().default([]),
  timeoutMs: z.number().int().min(1000).max(7200000).optional(),
});