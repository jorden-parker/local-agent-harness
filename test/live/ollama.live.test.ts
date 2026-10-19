import { execFile } from "node:child_process";
import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { OllamaBackend } from "../../src/backend/ollama-backend.js";
import { openRunLog } from "../../src/log/run-log.js";
import { buildSystemPrompt } from "../../src/prompt/system-prompt.js";
import { runTask } from "../../src/run/run-loop.js";

const run = promisify(execFile);
const MODEL = process.env["HARNESS_LIVE_MODEL"] ?? "qwen3:4b";

async function ollamaReachable(): Promise<boolean> {
  return fetch("http://localhost:11434/api/tags")
    .then((r) => r.ok)
    .catch(() => false);
}

const reachable = await ollamaReachable();

describe("live Ollama smoke test", () => {
  it.skipIf(!reachable)(
    "edits a file end to end under --yolo",
    async () => {
      const target = await realpath(await mkdtemp(join(tmpdir(), "harness-live-")));
      await run("git", ["init", "-q"], { cwd: target });
      await writeFile(join(target, "greeting.txt"), "hello world\n");
      const log = await openRunLog(target, new Date());
      const result = await runTask(
        "In greeting.txt replace the word hello with goodbye. Use the edit tool, then reply done.",
        await buildSystemPrompt(target),
        {
          target,
          model: MODEL,
          think: false,
          numCtx: 8192,
          timeoutMs: 180_000,
          limits: { maxIterations: 8, maxConsecutiveFailures: 3 },
          flags: { yolo: true, allowSecrets: false },
        },
        {
          backend: new OllamaBackend("http://localhost:11434"),
          confirmer: { confirm: () => Promise.resolve("y") },
          log,
          view: {
            replyStarted: () => undefined,
            thinkingText: () => undefined,
            replyText: () => undefined,
            replyEnded: () => undefined,
            confirmationStarted: () => undefined,
            toolFinished: () => undefined,
          },
        },
      );
      expect(await readFile(join(target, "greeting.txt"), "utf8")).toContain("goodbye");
      expect(result.iterations).toBeGreaterThan(0);
    },
    200_000,
  );
});
