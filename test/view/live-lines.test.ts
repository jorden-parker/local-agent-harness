import { describe, expect, it } from "vitest";
import type { GatePrompt } from "../../src/view/block-lines.js";
import { liveLines, type LiveContext } from "../../src/view/live-lines.js";
import { linesText } from "./line-text.js";

const context: LiveContext = {
  toggles: { thinking: true, toolOutput: false },
  lastKind: "reply",
  frame: 2,
  now: 14_500,
};
const prompt: GatePrompt = { question: "Allow shell: ls?", preview: "$ ls", toolName: "shell" };

describe("liveLines", () => {
  it("shows the spinner with whole seconds waited after one blank line", () => {
    expect(linesText(liveLines({ kind: "waiting", since: 0 }, context))).toEqual([
      " ",
      "⠹ waiting for model · 14s",
    ]);
  });

  it("shows the spinner with no blank line before the first block", () => {
    const first = { ...context, lastKind: undefined };
    expect(linesText(liveLines({ kind: "waiting", since: 0 }, first))).toHaveLength(1);
  });

  it("shows only the rows not yet committed", () => {
    const live = { kind: "stream", stream: "reply", text: "one\ntw", committedRows: 1 } as const;
    expect(linesText(liveLines(live, context))).toEqual(["  tw"]);
  });

  it("shows a running count while thinking is hidden", () => {
    const live = { kind: "stream", stream: "thinking", text: "abc", committedRows: 0 } as const;
    const hidden = { ...context, toggles: { thinking: false, toolOutput: false } };
    expect(linesText(liveLines(live, hidden))).toEqual(["∴ thinking… 3 chars"]);
  });

  it("shows the pending gate with the selected option filled", () => {
    const live = { kind: "gate", prompt, selected: 1, previewCommitted: false } as const;
    expect(linesText(liveLines(live, context))).toEqual([
      "◆ Allow shell: ls?",
      "│ $ ls",
      "│ ",
      "│ ○ yes",
      "│ ● no",
      "│ ○ allow every shell for this run",
      "└ ",
    ]);
  });

  it("keeps only the options live once the preview is printed above", () => {
    const live = { kind: "gate", prompt, selected: 0, previewCommitted: true } as const;
    expect(linesText(liveLines(live, context))[0]).toBe("│ ");
  });
});
