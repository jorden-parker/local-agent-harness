import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import type { ToolOutcome } from "../../src/tools/execute-tool.js";
import type { ToolCall } from "../../src/tools/tool-call.js";
import { formatToolLine } from "../../src/view/tool-line.js";

const ok = (output: string): ToolOutcome => ({ ok: true, output });
const fail = (output: string): ToolOutcome => ({ ok: false, output });

describe("formatToolLine", () => {
  it("shows the line count for a successful read", () => {
    const call: ToolCall = { id: "1", name: "read", arguments: { path: "a.txt" } };
    expect(stripVTControlCharacters(formatToolLine(call, ok("a\nb\n")))).toBe(
      "  ✓ read: a.txt · 2 lines",
    );
  });

  it("shows a single line as singular", () => {
    const call: ToolCall = { id: "1", name: "grep", arguments: { pattern: "foo" } };
    expect(stripVTControlCharacters(formatToolLine(call, ok("x.ts:1:foo")))).toBe(
      "  ✓ grep: foo · 1 line",
    );
  });

  it("shows zero lines for empty output", () => {
    const call: ToolCall = { id: "1", name: "glob", arguments: { pattern: "*.md" } };
    expect(stripVTControlCharacters(formatToolLine(call, ok("")))).toBe("  ✓ glob: *.md · 0 lines");
  });

  it("shows no detail for a successful edit", () => {
    const call: ToolCall = { id: "1", name: "edit", arguments: { path: "a.txt" } };
    expect(stripVTControlCharacters(formatToolLine(call, ok("edited a.txt")))).toBe(
      "  ✓ edit: a.txt",
    );
  });

  it("shows the first line of output for a failed shell call", () => {
    const call: ToolCall = { id: "1", name: "shell", arguments: { command: "pnpm test" } };
    expect(stripVTControlCharacters(formatToolLine(call, fail("exit 1\nboom")))).toBe(
      "  ✗ shell: pnpm test → exit 1",
    );
  });
});
