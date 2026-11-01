import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { RFClient } from "./client.js";

const serverUrl = process.env.REMOTE_FORGE_SERVER || "http://localhost:8787";
const token = process.env.REMOTE_FORGE_TOKEN;
const client = new RFClient(serverUrl, token);

const server = new McpServer({ name: "remoteforge", version: "0.1.0" });

function text(t: string) { return { content: [{ type: "text" as const, text: t }] }; }

// Session access
server.tool("remoteforge_request_session", "Request a remote execution session (requires human approval)", {
  agentIdentity: z.string(),
  projectName: z.string().optional(),
  requestedScopes: z.array(z.string()).min(1),
  nodeId: z.string().optional(),
}, async (args) => {
  const res = await client.request("POST", "/api/sessions/request", args);
  return text(JSON.stringify(res, null, 2));
});

server.tool("remoteforge_session_status", "Get session status", { sessionId: z.string() }, async ({ sessionId }) => {
  const res = await client.request("GET", `/api/sessions/${sessionId}`);
  return text(JSON.stringify(res, null, 2));
});

server.tool("remoteforge_claim_session", "Claim session token after approval using session secret", {
  sessionId: z.string(),
  sessionSecret: z.string(),
}, async ({ sessionId, sessionSecret }) => {
  const res = await client.request("POST", `/api/sessions/${sessionId}/claim`, { sessionSecret });
  if (res.token) client.setToken(res.token);
  return text(JSON.stringify(res, null, 2));
});

// Workspaces
server.tool("remoteforge_create_workspace", "Create a remote workspace", { nodeId: z.string(), name: z.string() }, async (args) => {
  const res = await client.request("POST", "/api/workspaces", args);
  const job = await client.pollJob(res.job.id);
  return text(JSON.stringify({ workspace: res.workspace, job }, null, 2));
});

server.tool("remoteforge_list_workspaces", "List workspaces", { nodeId: z.string().optional() }, async ({ nodeId }) => {
  const qs = nodeId ? `?nodeId=${nodeId}` : "";
  const res = await client.request("GET", `/api/workspaces${qs}`);
  return text(JSON.stringify(res, null, 2));
});

server.tool("remoteforge_destroy_workspace", "Destroy a workspace", { workspaceId: z.string() }, async ({ workspaceId }) => {
  const res = await client.request("DELETE", `/api/workspaces/${workspaceId}`);
  const job = await client.pollJob(res.job.id);
  return text(JSON.stringify(job, null, 2));
});

// Files
server.tool("remoteforge_list_files", "List files in a workspace", { workspaceId: z.string(), path: z.string().optional() }, async ({ workspaceId, path }) => {
  const res = await client.request("POST", `/api/workspaces/${workspaceId}/files/list`, { path: path || "." });
  const job = await client.pollJob(res.job.id);
  return text(JSON.stringify(job.result, null, 2));
});

server.tool("remoteforge_read_file", "Read a file from a workspace", { workspaceId: z.string(), path: z.string() }, async ({ workspaceId, path }) => {
  const res = await client.request("POST", `/api/workspaces/${workspaceId}/files/read`, { path });
  const job = await client.pollJob(res.job.id);
  return text(JSON.stringify(job.result, null, 2));
});

server.tool("remoteforge_write_file", "Write a file to a workspace (content base64)", { workspaceId: z.string(), path: z.string(), content: z.string(), encoding: z.enum(["utf8","base64"]).optional() }, async (args) => {
  const res = await client.request("POST", `/api/workspaces/${args.workspaceId}/files/write`, args);
  const job = await client.pollJob(res.job.id);
  return text(JSON.stringify(job.result, null, 2));
});

// Commands
server.tool("remoteforge_run_command", "Run a command in a workspace", { workspaceId: z.string(), command: z.string(), args: z.array(z.string()).optional(), cwd: z.string().optional(), timeoutMs: z.number().optional() }, async (args) => {
  const res = await client.request("POST", `/api/workspaces/${args.workspaceId}/commands`, args);
  const job = await client.pollJob(res.job.id);
  return text(JSON.stringify({ status: job.status, exitCode: job.exitCode, result: job.result, logs: job.logs }, null, 2));
});

server.tool("remoteforge_install_dependencies", "Install dependencies", { workspaceId: z.string(), manager: z.string().optional(), args: z.array(z.string()).optional() }, async (args) => {
  const res = await client.request("POST", `/api/workspaces/${args.workspaceId}/install`, args);
  const job = await client.pollJob(res.job.id);
  return text(JSON.stringify({ status: job.status, exitCode: job.exitCode, result: job.result, logs: job.logs }, null, 2));
});

// Processes
server.tool("remoteforge_start_process", "Start a background process", { workspaceId: z.string(), command: z.string(), args: z.array(z.string()).optional() }, async (args) => {
  const res = await client.request("POST", `/api/workspaces/${args.workspaceId}/processes`, args);
  const job = await client.pollJob(res.job.id);
  return text(JSON.stringify(job.result, null, 2));
});

server.tool("remoteforge_stop_process", "Stop a background process", { workspaceId: z.string(), pid: z.number() }, async (args) => {
  const res = await client.request("POST", `/api/workspaces/${args.workspaceId}/processes/stop`, { pid: args.pid });
  const job = await client.pollJob(res.job.id);
  return text(JSON.stringify(job.result, null, 2));
});

// Build
server.tool("remoteforge_build", "Build a project", { workspaceId: z.string(), profile: z.string(), command: z.string().optional(), args: z.array(z.string()).optional(), timeoutMs: z.number().optional() }, async (args) => {
  const res = await client.request("POST", `/api/workspaces/${args.workspaceId}/build`, args);
  const job = await client.pollJob(res.job.id);
  return text(JSON.stringify({ status: job.status, exitCode: job.exitCode, result: job.result, logs: job.logs }, null, 2));
});

// Artifacts
server.tool("remoteforge_list_artifacts", "List artifacts", { workspaceId: z.string().optional() }, async ({ workspaceId }) => {
  const qs = workspaceId ? `?workspaceId=${workspaceId}` : "";
  const res = await client.request("GET", `/api/artifacts${qs}`);
  return text(JSON.stringify(res, null, 2));
});

server.tool("remoteforge_collect_artifacts", "Collect artifacts from a workspace", { workspaceId: z.string(), path: z.string().optional() }, async (args) => {
  const res = await client.request("POST", `/api/workspaces/${args.workspaceId}/commands`, { command: "tar", args: ["-czf", "/tmp/artifacts.tar.gz", args.path || "."] });
  // fallback: use collect via run_command already; instead call artifact collection job type not exposed. Use run_command result.
  return text(JSON.stringify(res, null, 2));
});

server.tool("remoteforge_download_artifact", "Download an artifact as base64", { artifactId: z.string() }, async ({ artifactId }) => {
  const url = `${process.env.REMOTE_FORGE_SERVER || "http://localhost:8787"}/api/artifacts/${artifactId}/download`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${client.getToken()}` } });
  const buf = Buffer.from(await res.arrayBuffer());
  return text(JSON.stringify({ artifactId, size: buf.length, content: buf.toString("base64") }, null, 2));
});

const transport = new StdioServerTransport();
await server.connect(transport);