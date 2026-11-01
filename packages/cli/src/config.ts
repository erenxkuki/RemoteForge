import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export interface CliConfig {
  serverUrl: string;
  token: string | null;
  username: string | null;
}

const CONFIG_DIR = path.join(os.homedir(), ".remoteforge");
const CONFIG_FILE = path.join(CONFIG_DIR, "cli.json");

export async function loadConfig(): Promise<CliConfig> {
  try {
    const raw = await readFile(CONFIG_FILE, "utf8");
    return JSON.parse(raw) as CliConfig;
  } catch {
    return { serverUrl: "http://localhost:8787", token: null, username: null };
  }
}

export async function saveConfig(cfg: CliConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}