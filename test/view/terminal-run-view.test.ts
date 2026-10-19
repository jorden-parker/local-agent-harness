import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolCall } from "../../src/tools/tool-call.js";
import type { ToolOutcome } from "../../src/tools/execute-tool.js";
import { TerminalRunView } from "../../src/view/terminal-run-view.js";

const readCall: ToolCall = { id: "1", name: "read", arguments: { path: "a.txt" } };
const editCall: ToolCall = { id: "2", name: "edit", arguments: { path: "a.txt" } };
const readOk: ToolOutcome = { ok: true, output: "x\n" };
const editOk: ToolOutcome = { ok: true, output: "edited" };
const CLEAR_LINE = "\r\u001b[2K";

describe("TerminalRunView", () => {
  let writes: string[];
  const sink = (text: string): void => {
    writes.push(text);
  };
  const shown = (): string => stripVTControlCharacters(writes.join(""));
  const quietView = (): TerminalRunView => new TerminalRunView(sink, false);

  function reply(view: TerminalRunView, ...chunks: string[]): void {
    view.replyStarted();
    for (const chunk of chunks) view.replyText(chunk);
    view.replyEnded();
  }

  beforeEach(() => {
    writes = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks a reply with a dot and indents its later lines", () => {
    reply(quietView(), "Hi ", "there\nsecond line");
    expect(shown()).toBe("● Hi there\n  second line\n");
  });

  it("drops blank lines the model sends before its text", () => {
    reply(quietView(), "\n\n", "  Hi");
    expect(shown()).toBe("● Hi\n");
  });

  it("nests tool lines under the reply with no blank line", () => {
    const view = quietView();
    reply(view, "Looking.");
    view.toolFinished(readCall, readOk);
    view.toolFinished(readCall, readOk);
    expect(shown()).toBe("● Looking.\n  ✓ read: a.txt · 1 line\n  ✓ read: a.txt · 1 line\n");
  });

  it("ends a partial line before writing a tool line", () => {
    const view = quietView();
    view.replyStarted();
    view.replyText("partial");
    view.toolFinished(readCall, readOk);
    expect(shown()).toBe("● partial\n  ✓ read: a.txt · 1 line\n");
  });

  it("puts one blank line between replies", () => {
    const view = quietView();
    reply(view, "First.");
    view.toolFinished(readCall, readOk);
    reply(view, "Second.");
    expect(shown()).toBe("● First.\n  ✓ read: a.txt · 1 line\n\n● Second.\n");
  });

  it("keeps a gated tool line right under its Confirmation", () => {
    const view = quietView();
    reply(view, "Editing.");
    view.confirmationStarted();
    writes.push("◇ Allow edit: a.txt? · yes\n");
    view.toolFinished(editCall, editOk);
    view.toolFinished(readCall, readOk);
    expect(shown()).toBe(
      "● Editing.\n\n◇ Allow edit: a.txt? · yes\n  ✓ edit: a.txt\n\n  ✓ read: a.txt · 1 line\n",
    );
  });

  it("starts a gate without a blank line when the reply had no text", () => {
    const view = quietView();
    reply(view, "First.");
    reply(view);
    view.confirmationStarted();
    expect(shown()).toBe("● First.\n\n");
  });

  it("shows thinking as its own dim block before the reply", () => {
    const view = quietView();
    view.replyStarted();
    view.thinkingText("\nHmm,\nlet me look.");
    view.replyText("Done.");
    view.replyEnded();
    expect(shown()).toBe("∴ Hmm,\n  let me look.\n\n● Done.\n");
  });

  it("writes nothing when started and not interactive", () => {
    quietView().replyStarted();
    expect(writes).toEqual([]);
  });

  it("clears the spinner line before the first streamed text when interactive", () => {
    vi.useFakeTimers();
    const view = new TerminalRunView(sink, true);
    reply(view, "x");
    expect(stripVTControlCharacters(writes[0] ?? "")).toMatch(/waiting for model · 0s$/);
    expect(writes).toContain(CLEAR_LINE);
    expect(stripVTControlCharacters(writes.slice(writes.indexOf(CLEAR_LINE) + 1).join(""))).toBe(
      "● x\n",
    );
  });
});
