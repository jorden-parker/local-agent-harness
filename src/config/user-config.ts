import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface UserConfig {
  allowedBackendHosts: string[];
  defaultModel: string | undefined;
}

const USER_CONFIG_PATH = join(homedir(), ".config", "harness", "config.json");

export async function loadUserConfig(path = USER_CONFIG_PATH): Promise<UserConfig> {
  const raw = await readFile(path, "utf8").catch(() => "{}");
  const parsed = JSON.parse(raw) as Partial<UserConfig>;
  return {
    allowedBackendHosts: parsed.allowedBackendHosts ?? [],
    defaultModel: parsed.defaultModel,
  };
}
