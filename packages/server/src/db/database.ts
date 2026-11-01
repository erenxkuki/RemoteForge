import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");
type DatabaseSync = DatabaseSyncType;
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export type Db = DatabaseSync;

export interface DbOptions {
  path: string;
}

export function openDatabase(opts: DbOptions): DatabaseSync {
  const db = new DatabaseSync(opts.path === ":memory:" ? ":memory:" : opts.path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  const candidates = [
    path.join(path.dirname(fileURLToPath(import.meta.url)), "schema.sql"),
    path.join(process.cwd(), "packages", "server", "src", "db", "schema.sql"),
    path.join(process.cwd(), "src", "db", "schema.sql"),
  ];
  let schema = "";
  for (const c of candidates) {
    try { schema = readFileSync(c, "utf8"); break; } catch {}
  }
  if (!schema) throw new Error("schema.sql not found");
  db.exec(schema);
  return db;
}

export function closeDatabase(db: DatabaseSync): void {
  db.close();
}