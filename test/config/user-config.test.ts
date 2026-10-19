import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadUserConfig } from "../../src/config/user-config.js";

async function configFile(contents: string): Promise<string> {
  const path = join(await mkdtemp(join(tmpdir(), "harness-config-")), "config.json");
  await writeFile(path, contents);
  return path;
}

describe("loadUserConfig", () => {
  it("reads defaultModel", async () => {
    const path = await configFile(`{"defaultModel": "qwen3:4b-instruct-2507-q4_K_M"}`);
    expect((await loadUserConfig(path)).defaultModel).toBe("qwen3:4b-instruct-2507-q4_K_M");
  });

  it("leaves defaultModel unset when the file is missing", async () => {
    const config = await loadUserConfig(join(tmpdir(), "no-such-harness-config.json"));
    expect(config).toEqual({ allowedBackendHosts: [], defaultModel: undefined });
  });
});
