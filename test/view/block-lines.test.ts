import { describe, expect, it } from "vitest";
import type { ToolOutcome } from "../../src/tools/execute-tool.js";
import type { ToolCall } from "../../src/tools/tool-call.js";
import { blockLines, previewLines, type Block, type Toggles } from "../../src/view/block-lines.js";
import { linesText } from "./line-text.js";

const collapsed: Toggles = { thinking: true, toolOutput: false };
const expanded: Toggles = { thinking: true, toolOutput: true };
const ok = (output: string): ToolOutcome => ({ ok: true, output });
const fail = (output: string): ToolOutcome => ({ ok: false, output });
const shown = (block: Block, toggles: Toggles = collapsed): string[] =>
  linesText(blockLines(block, toggles));
const tool = (call: ToolCall, outcome: ToolOutcome): Block => ({ kind: "tool", call, outcome });

describe("tool block", () => {
  it("shows the line count for a successful read", () => {
    const call: ToolCall = { id: "1", name: "read", arguments: { path: "a.txt" } };
    expect(shown(tool(call, ok("a\nb\n")))).toEqual(["  ✓ read: a.txt · 2 lines"]);
  });

  it("shows a single line as singular and empty output as zero", () => {
    const grep: ToolCall = { id: "1", name: "grep", arguments: { pattern: "foo" } };
    const glob: ToolCall = { id: "2", name: "glob", arguments: { pattern: "*.md" } };
    expect(shown(tool(grep, ok("x.ts:1:foo")))).toEqual(["  ✓ grep: foo · 1 line"]);
    expect(shown(tool(glob, ok("")))).toEqual(["  ✓ glob: *.md · 0 lines"]);
  });

  it("shows no detail for a successful edit", () => {
    const call: ToolCall = { id: "1", name: "edit", arguments: { path: "a.txt" } };
    expect(shown(tool(call, ok("edited a.txt")))).toEqual(["  ✓ edit: a.txt"]);
  });

  it("shows the first line of output for a failed call", () => {
    const call: ToolCall = { id: "1", name: "shell", arguments: { command: "pnpm test" } };
    expect(shown(tool(call, fail("exit 1\nboom")))).toEqual(["  ✗ shell: pnpm test → exit 1"]);
  });

  it("lists the output under the tool line when tool output is on", () => {
    const call: ToolCall = { id: "1", name: "read", arguments: { path: "a.txt" } };
    expect(shown(tool(call, ok("a\nb\n")), expanded)).toEqual([
      "  ✓ read: a.txt · 2 lines",
      "  │ a",
      "  │ b",
    ]);
  });

  it("caps listed output at eight lines", () => {
    const call: ToolCall = { id: "1", name: "read", arguments: { path: "a.txt" } };
    const output = Array.from({ length: 12 }, (_, index) => `row ${index}`).join("\n");
    const rows = shown(tool(call, ok(output)), expanded);
    expect(rows).toHaveLength(10);
    expect(rows.at(-1)).toBe("  │ … 4 more lines");
  });
});

describe("thinking block", () => {
  it("shows the thinking when it is on", () => {
    expect(shown({ kind: "thinking", text: "Hmm,\nok." })).toEqual(["∴ Hmm,", "  ok."]);
  });

  it("collapses to one row when it is off", () => {
    expect(
      shown({ kind: "thinking", text: "Hmm" }, { thinking: false, toolOutput: false }),
    ).toEqual(["∴ thinking · 3 chars hidden"]);
  });
});

describe("header, task and summary", () => {
  const header: Block = {
    kind: "header",
    model: "m",
    backendUrl: "http://h",
    logPath: "/l.jsonl",
    think: false,
    width: 10,
  };

  it("shows the model, log and rule", () => {
    expect(shown(header)).toEqual(["harness · m via http://h", "log /l.jsonl", "──────────"]);
  });

  it("says when thinking is on", () => {
    expect(shown({ ...header, think: true })[0]).toBe("harness · m via http://h · thinking on");
  });

  it("puts the task on a band with the prompt marker", () => {
    const [line] = blockLines({ kind: "task", text: "do it" }, collapsed);
    expect(linesText(line ? [line] : [])).toEqual(["> do it"]);
    expect(line?.band).toBe(true);
  });

  it("shows a final answer with seconds", () => {
    const summary: Block = {
      kind: "summary",
      endReason: "model gave a final answer",
      iterations: 1,
      elapsedMs: 4_400,
      width: 3,
    };
    expect(shown(summary)).toEqual(["───", "✓ model gave a final answer · 1 tool call · 4s"]);
  });

  it("shows a stopped run with minutes and padded seconds", () => {
    const summary: Block = {
      kind: "summary",
      endReason: "iteration cap reached",
      iterations: 50,
      elapsedMs: 125_000,
      width: 3,
    };
    expect(shown(summary)[1]).toBe("! iteration cap reached · 50 tool calls · 2m 05s");
  });
});

describe("gate block", () => {
  const prompt = { question: "Allow shell: ls?", preview: "$ ls", toolName: "shell" as const };

  it("puts the answer on the question line and keeps the preview", () => {
    expect(shown({ kind: "gate", prompt, choice: "y", previewCommitted: false })).toEqual([
      "◇ Allow shell: ls? · yes",
      "│ $ ls",
    ]);
  });

  it("leaves the preview out when it was already printed above", () => {
    expect(shown({ kind: "gate", prompt, choice: "a", previewCommitted: true })).toEqual([
      "◇ Allow shell: ls? · allow every shell for this run",
    ]);
  });
});

describe("previewLines", () => {
  it("drops the file headers and keeps the hunk", () => {
    const preview = "Index: a.txt\n====\n--- a.txt\n+++ a.txt\n@@ -1,1 +1,1 @@\n-hello\n+bye\n";
    expect(linesText(previewLines(preview))).toEqual(["│ @@ -1,1 +1,1 @@", "│ -hello", "│ +bye"]);
  });

  it("keeps a removed line that looks like a file header inside a hunk", () => {
    expect(linesText(previewLines("@@ -1 +1 @@\n--- old\n+new\n"))).toEqual([
      "│ @@ -1 +1 @@",
      "│ --- old",
      "│ +new",
    ]);
  });

  it("shows a message that has no hunk", () => {
    expect(linesText(previewLines("edit cannot be applied: see tool result"))).toEqual([
      "│ edit cannot be applied: see tool result",
    ]);
  });
});
