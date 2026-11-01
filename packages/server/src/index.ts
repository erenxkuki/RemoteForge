#!/usr/bin/env node
import { buildApp } from "./app.js";

const port = Number(process.env.PORT ?? process.env.REMOTE_FORGE_PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";
const dbPath = process.env.REMOTE_FORGE_DB ?? "./remoteforge.db";

const app = await buildApp({ dbPath, logger: process.env.LOG_LEVEL === "debug" });
await app.listen({ port, host });
// eslint-disable-next-line no-console
console.log(`RemoteForge server listening on http://${host}:${port} (db: ${dbPath})`);

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);