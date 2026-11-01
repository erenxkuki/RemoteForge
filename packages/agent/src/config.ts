import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export interface AgentConfig {
  serverUrl: string;
  nodeId: string | null;
  nodeToken: string | null;
  name: string;
}

const CONFIG_DIR = path.join(os.homedir(), ".remoteforge");
const CONFIG_FILE = path.join(CONFIG_DIR, "agent.json");

export async function loadConfig(): Promise<AgentConfig | null> {
  try {
    const raw = await readFile(CONFIG_FILE, "utf8");
    return JSON.parse(raw) as AgentConfig;
  } catch {
    return null;
  }
}

export async function saveConfig(cfg: AgentConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

export function defaultConfig(serverUrl: string, name: string): AgentConfig {
  return { serverUrl, nodeId: null, nodeToken: null, name };
}