import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openRunLog } from "../../src/log/runLog.js";

describe("openRunLog", () => {
  it("writes jsonl entries and keeps the folder out of git", async () => {
    const target = await mkdtemp(join(tmpdir(), "harness-log-"));
    const log = await openRunLog(target, new Date("2026-10-19T10:00:00Z"));
    await log.record({ event: "start" });
    expect(log.path).toBe(join(target, ".harness", "runs", "2026-10-19T10-00-00-000Z.jsonl"));
    expect(await readFile(log.path, "utf8")).toMatch(/"event":"start"/);
    expect(await readFile(join(target, ".harness", ".gitignore"), "utf8")).toBe("*\n");
  });
});
