import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { ChatChunk } from "../../src/backend/backend.js";
import type { Confirmer } from "../../src/gate/confirmer.js";
import type { RunLog } from "../../src/log/runLog.js";
import { runTask, type RunOptions } from "../../src/run/runLoop.js";
import type { ConfirmationChoice } from "../../src/run/runState.js";
import { FakeBackend } from "../backend/fakeBackend.js";

let target: string;
let entries: Record<string, unknown>[];

const log: RunLog = {
  path: "memory",
  record: (entry) => {
    entries.push(entry);
    return Promise.resolve();
  },
};

function scriptedConfirmer(choices: ConfirmationChoice[]): Confirmer {
  return { confirm: () => Promise.resolve(choices.shift() ?? "n") };
}

function options(flags: Partial<RunOptions["flags"]> = {}): RunOptions {
  return {
    target,
    model: "fake",
    think: false,
    numCtx: 1024,
    timeoutMs: 5000,
    limits: { maxIterations: 10, maxConsecutiveFailures: 3 },
    flags: { yolo: false, allowSecrets: false, ...flags },
  };
}

const toolCall = (name: "read" | "edit" | "shell", args: Record<string, unknown>): ChatChunk => ({
  type: "tool_call",
  call: { id: "c", name, arguments: args },
});
const text = (value: string): ChatChunk => ({ type: "text", text: value });

beforeEach(async () => {
  target = await realpath(await mkdtemp(join(tmpdir(), "harness-run-")));
  await writeFile(join(target, "a.txt"), "hello\n");
  entries = [];
});

describe("runTask", () => {
  it("reads, edits with confirmation, then ends on a final answer", async () => {
    const backend = new FakeBackend([
      [toolCall("read", { path: "a.txt" })],
      [toolCall("edit", { path: "a.txt", old: "hello", new: "bye" })],
      [text("Done.")],
    ]);
    const output: string[] = [];
    const result = await runTask("change hello to bye", "sys", options(), {
      backend,
      confirmer: scriptedConfirmer(["y"]),
      log,
      out: (t) => output.push(t),
    });
    expect(result).toEqual({ endReason: "model gave a final answer", iterations: 2 });
    expect(await readFile(join(target, "a.txt"), "utf8")).toBe("bye\n");
    expect(backend.requests[1]?.messages.at(-1)).toEqual({
      role: "tool",
      content: "hello\n",
      tool_name: "read",
    });
    expect(output.join("")).toContain("Done.");
  });

  it("feeds a decline back to the model and ends after three", async () => {
    const edit = toolCall("edit", { path: "a.txt", old: "hello", new: "bye" });
    const backend = new FakeBackend([[edit], [edit], [edit]]);
    const result = await runTask("t", "sys", options(), {
      backend,
      confirmer: scriptedConfirmer(["n", "n", "n"]),
      log,
      out: () => undefined,
    });
    expect(result.endReason).toBe("three consecutive tool failures");
    expect(backend.requests[1]?.messages.at(-1)).toEqual({
      role: "tool",
      content: "the user declined this tool call",
      tool_name: "edit",
    });
  });

  it("never runs denylisted shell even under yolo", async () => {
    const backend = new FakeBackend([[toolCall("shell", { command: "rm -rf /" })], [text("ok")]]);
    const result = await runTask("t", "sys", options({ yolo: true }), {
      backend,
      confirmer: scriptedConfirmer([]),
      log,
      out: () => undefined,
    });
    expect(result.endReason).toBe("model gave a final answer");
    expect(backend.requests[1]?.messages.at(-1)).toEqual({
      role: "tool",
      content: "rejected: denylisted command, never run",
      tool_name: "shell",
    });
  });

  it("reports backend errors as the end reason", async () => {
    const backend = new FakeBackend([]);
    const result = await runTask("t", "sys", options(), {
      backend,
      confirmer: scriptedConfirmer([]),
      log,
      out: () => undefined,
    });
    expect(result.endReason).toMatch(/backend error: FakeBackend has no scripted turn left/);
    expect(entries.at(-1)).toMatchObject({ event: "end" });
  });
});
