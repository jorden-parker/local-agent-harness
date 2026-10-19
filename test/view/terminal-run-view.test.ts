import { stripVTControlCharacters } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolCall } from "../../src/tools/tool-call.js";
import type { ToolOutcome } from "../../src/tools/execute-tool.js";
import { TerminalRunView } from "../../src/view/terminal-run-view.js";

const readCall: ToolCall = { id: "1", name: "read", arguments: { path: "a.txt" } };
const readOk: ToolOutcome = { ok: true, output: "x\n" };
const CLEAR_LINE = "\r\u001b[2K";

describe("TerminalRunView", () => {
  let writes: string[];
  const sink = (text: string): void => {
    writes.push(text);
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  it("indents streamed text and ends the line when the reply ends", () => {
    writes = [];
    const view = new TerminalRunView(sink, false);
    view.replyStarted();
    view.replyText("Hi ");
    view.replyText("there");
    view.replyEnded();
    expect(stripVTControlCharacters(writes.join(""))).toBe("  Hi there\n");
  });

  it("writes a tool line after the reply on its own line", () => {
    writes = [];
    const view = new TerminalRunView(sink, false);
    view.replyStarted();
    view.replyText("Hi ");
    view.replyText("there");
    view.replyEnded();
    view.toolFinished(readCall, readOk);
    expect(stripVTControlCharacters(writes.join(""))).toBe(
      "  Hi there\n  ✓ read: a.txt · 1 line\n",
    );
  });

  it("ends a partial line before writing a tool line", () => {
    writes = [];
    const view = new TerminalRunView(sink, false);
    view.replyStarted();
    view.replyText("partial");
    view.toolFinished(readCall, readOk);
    expect(stripVTControlCharacters(writes.join(""))).toBe("  partial\n  ✓ read: a.txt · 1 line\n");
  });

  it("writes nothing when started and not interactive", () => {
    writes = [];
    const view = new TerminalRunView(sink, false);
    view.replyStarted();
    expect(writes).toEqual([]);
  });

  it("clears the spinner line before the first streamed text when interactive", () => {
    vi.useFakeTimers();
    writes = [];
    const view = new TerminalRunView(sink, true);
    view.replyStarted();
    view.replyText("x");
    view.replyEnded();
    expect(stripVTControlCharacters(writes[0] ?? "")).toMatch(/waiting for model$/);
    expect(writes.at(-3)).toBe(CLEAR_LINE);
    expect(writes.at(-2)).toBe("  x");
    expect(writes.at(-1)).toBe("\n");
  });
});
