import { Command } from "commander";
import { loadConfig, saveConfig } from "./config.js";
import { CliClient } from "./client.js";
import { runSetup } from "./setup.js";

const program = new Command();
program.name("remoteforge").description("RemoteForge CLI").version("0.1.4");

program
  .command("setup")
  .description("Interactive setup: configure your AI coding agent for RemoteForge")
  .action(async () => {
    await runSetup();
  });

function serverUrlOverride(opts: any): string | undefined {
  return opts.server;
}

program
  .command("config")
  .description("Show CLI config")
  .action(async () => {
    const cfg = await loadConfig();
    console.log(JSON.stringify(cfg, null, 2));
  });

program
  .command("bootstrap")
  .description("Bootstrap the first admin user (only if no users exist)")
  .requiredOption("-u, --username <username>", "admin username")
  .requiredOption("-p, --password <password>", "admin password")
  .option("-s, --server <url>", "server url")
  .action(async (opts) => {
    const cfg = await loadConfig();
    const url = opts.server ?? cfg.serverUrl;
    const client = new CliClient(url);
    const res = await client.request("POST", "/api/auth/bootstrap", { username: opts.username, password: opts.password });
    cfg.serverUrl = url;
    cfg.token = res.token;
    cfg.username = res.username;
    await saveConfig(cfg);
    console.log("Bootstrapped admin:", res.username);
    console.log("Token saved.");
  });

program
  .command("login")
  .description("Login as admin")
  .requiredOption("-u, --username <username>", "username")
  .requiredOption("-p, --password <password>", "password")
  .option("-s, --server <url>", "server url")
  .action(async (opts) => {
    const cfg = await loadConfig();
    const url = opts.server ?? cfg.serverUrl;
    const client = new CliClient(url);
    const res = await client.request("POST", "/api/auth/login", { username: opts.username, password: opts.password });
    cfg.serverUrl = url;
    cfg.token = res.token;
    cfg.username = res.username;
    await saveConfig(cfg);
    console.log("Logged in as", res.username);
  });

function authedClient(cfg: any) {
  return new CliClient(cfg.serverUrl, cfg.token);
}

program
  .command("pairings")
  .description("List pending pairings")
  .action(async () => {
    const cfg = await loadConfig();
    const client = authedClient(cfg);
    const res = await client.request("GET", "/api/pairing");
    console.log(JSON.stringify(res.items, null, 2));
  });

program
  .command("pairing-approve <id>")
  .description("Approve a pairing request")
  .action(async (id) => {
    const cfg = await loadConfig();
    const client = authedClient(cfg);
    const res = await client.request("POST", `/api/pairing/${id}/approve`, {});
    console.log("Approved. Node:", JSON.stringify(res.node, null, 2));
  });

program
  .command("pairing-reject <id>")
  .description("Reject a pairing request")
  .action(async (id) => {
    const cfg = await loadConfig();
    const client = authedClient(cfg);
    await client.request("POST", `/api/pairing/${id}/reject`, {});
    console.log("Rejected.");
  });

program
  .command("nodes")
  .description("List VPS nodes")
  .action(async () => {
    const cfg = await loadConfig();
    const client = authedClient(cfg);
    const res = await client.request("GET", "/api/nodes");
    console.log(JSON.stringify(res.items, null, 2));
  });

program
  .command("node-revoke <id>")
  .description("Revoke a VPS node")
  .action(async (id) => {
    const cfg = await loadConfig();
    const client = authedClient(cfg);
    await client.request("POST", `/api/nodes/${id}/revoke`, {});
    console.log("Revoked node", id);
  });

program
  .command("sessions")
  .description("List sessions")
  .option("-s, --status <status>", "filter by status")
  .action(async (opts) => {
    const cfg = await loadConfig();
    const client = authedClient(cfg);
    const qs = opts.status ? `?status=${encodeURIComponent(opts.status)}` : "";
    const res = await client.request("GET", `/api/sessions${qs}`);
    console.log(JSON.stringify(res.items, null, 2));
  });

program
  .command("session-approve <id>")
  .description("Approve a session request")
  .requiredOption("--scopes <scopes>", "comma-separated scopes")
  .action(async (id, opts) => {
    const cfg = await loadConfig();
    const client = authedClient(cfg);
    const scopes = opts.scopes.split(",").map((s: string) => s.trim());
    const res = await client.request("POST", `/api/sessions/${id}/approve`, { approvedScopes: scopes });
    console.log("Approved. Session:", JSON.stringify(res.session, null, 2));
    console.log("Agent must claim with session secret to receive token.");
  });

program
  .command("session-reject <id>")
  .description("Reject a session request")
  .action(async (id) => {
    const cfg = await loadConfig();
    const client = authedClient(cfg);
    await client.request("POST", `/api/sessions/${id}/reject`, {});
    console.log("Rejected.");
  });

program
  .command("session-revoke <id>")
  .description("Revoke a session")
  .action(async (id) => {
    const cfg = await loadConfig();
    const client = authedClient(cfg);
    await client.request("POST", `/api/sessions/${id}/revoke`, {});
    console.log("Revoked.");
  });

program
  .command("audit")
  .description("Show audit log")
  .option("-n, --limit <n>", "limit", "50")
  .action(async (opts) => {
    const cfg = await loadConfig();
    const client = authedClient(cfg);
    const res = await client.request("GET", `/api/audit?limit=${opts.limit}`);
    console.log(JSON.stringify(res.items, null, 2));
  });

program.parseAsync(process.argv).catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});