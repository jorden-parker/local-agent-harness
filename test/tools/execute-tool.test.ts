import { mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { executeTool } from "../../src/tools/execute-tool.js";
import type { ToolCall } from "../../src/tools/tool-call.js";

let target: string;

function call(name: ToolCall["name"], args: Record<string, unknown>): ToolCall {
  return { id: "1", name, arguments: args };
}

beforeEach(async () => {
  target = await realpath(await mkdtemp(join(tmpdir(), "harness-")));
  await writeFile(join(target, "a.ts"), "const a = 1;\nconst b = 2;\n");
});

describe("executeTool", () => {
  it("reads, writes and edits inside the target", async () => {
    expect(await executeTool(target, call("read", { path: "a.ts" }))).toEqual({
      ok: true,
      output: "const a = 1;\nconst b = 2;\n",
    });
    expect((await executeTool(target, call("write", { path: "sub/b.ts", content: "x" }))).ok).toBe(
      true,
    );
    expect(
      (await executeTool(target, call("edit", { path: "a.ts", old: "a = 1", new: "a = 9" }))).ok,
    ).toBe(true);
    expect((await executeTool(target, call("read", { path: "a.ts" }))).output).toContain("a = 9");
  });

  it("fails an edit whose old text is ambiguous", async () => {
    const result = await executeTool(
      target,
      call("edit", { path: "a.ts", old: "const", new: "let" }),
    );
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/appears 2 times/);
  });

  it("fails on a missing file", async () => {
    const result = await executeTool(target, call("read", { path: "nope.ts" }));
    expect(result).toEqual({ ok: false, output: "cannot read nope.ts: file not found" });
  });

  it("refuses to follow a symlink out of the target", async () => {
    await symlink("/etc", join(target, "escape"));
    const result = await executeTool(target, call("read", { path: "escape/hosts" }));
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/outside the target/);
  });

  it("globs and greps", async () => {
    expect((await executeTool(target, call("glob", { pattern: "**/*.ts" }))).output).toBe("a.ts");
    expect((await executeTool(target, call("grep", { pattern: "b = " }))).output).toBe(
      "a.ts:2: const b = 2;",
    );
  });

  it("runs shell commands in the target and reports failures", async () => {
    expect(await executeTool(target, call("shell", { command: "ls" }))).toEqual({
      ok: true,
      output: "a.ts\n",
    });
    const failed = await executeTool(target, call("shell", { command: "exit 3" }));
    expect(failed).toEqual({ ok: false, output: "exit 3\n" });
  });
});
