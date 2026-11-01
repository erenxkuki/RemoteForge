import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

const BASE = process.env.REMOTE_FORGE_DATA ?? "./data";

export function dataDir(): string {
  const d = path.resolve(BASE);
  mkdirSync(d, { recursive: true });
  return d;
}

export function uploadsDir(): string {
  const d = path.join(dataDir(), "uploads");
  mkdirSync(d, { recursive: true });
  return d;
}

export function artifactsDir(): string {
  const d = path.join(dataDir(), "artifacts");
  mkdirSync(d, { recursive: true });
  return d;
}

export function newStoredPath(dir: string, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const name = `${Date.now()}_${randomBytes(6).toString("hex")}_${safe}`;
  return path.join(dir, name);
}

export function writeFileBytes(filePath: string, data: Buffer): void {
  writeFileSync(filePath, data);
}

export function readFileBytes(filePath: string): Buffer {
  return readFileSync(filePath);
}

export function fileExists(p: string): boolean {
  return existsSync(p);
}