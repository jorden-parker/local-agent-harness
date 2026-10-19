import { describe, expect, it } from "vitest";
import type { ToolCall } from "../../src/tools/tool-call.js";
import type { GatePrompt } from "../../src/view/block-lines.js";
import { RunStore } from "../../src/view/run-store.js";
import { linesText } from "./line-text.js";

const readCall: ToolCall = { id: "1", name: "read", arguments: { path: "a.txt" } };
const shellPrompt: GatePrompt = {
  question: "Allow shell: ls?",
  preview: "$ ls",
  toolName: "shell",
};
const ROOMY = 40;

function committed(store: RunStore): string[] {
  return linesText(store.getSnapshot().committed.map((entry) => entry.line));
}

function reply(store: RunStore, ...chunks: string[]): void {
  store.startWaiting(0);
  for (const chunk of chunks) store.streamText("reply", chunk);
  store.endReply();
}

function readTool(store: RunStore, output = "x\n"): void {
  store.addBlock({ kind: "tool", call: readCall, outcome: { ok: true, output } });
}

describe("RunStore streaming", () => {
  it("commits finished rows and keeps the partial row live", () => {
    const store = new RunStore();
    store.startWaiting(0);
    store.streamText("reply", "one\ntw");
    expect(committed(store)).toEqual(["● one"]);
    expect(store.getSnapshot().live).toMatchObject({
      kind: "stream",
      text: "one\ntw",
      committedRows: 1,
    });
    store.endReply();
    expect(committed(store)).toEqual(["● one", "  tw"]);
    expect(store.getSnapshot().live).toEqual({ kind: "idle" });
  });

  it("drops blank lines the model sends before its text", () => {
    const store = new RunStore();
    reply(store, "\n\n", "  Hi");
    expect(committed(store)).toEqual(["● Hi"]);
  });

  it("nests tool lines under a reply and separates replies by one blank line", () => {
    const store = new RunStore();
    reply(store, "First.");
    readTool(store);
    reply(store, "Second.");
    expect(committed(store)).toEqual(["● First.", "  ✓ read: a.txt · 1 line", " ", "● Second."]);
  });

  it("separates thinking from the reply that follows it", () => {
    const store = new RunStore();
    store.startWaiting(0);
    store.streamText("thinking", "Hmm,\nok.");
    store.streamText("reply", "Done.");
    store.endReply();
    expect(committed(store)).toEqual(["∴ Hmm,", "  ok.", " ", "● Done."]);
  });

  it("collapses thinking to one row while thinking is hidden", () => {
    const store = new RunStore();
    store.toggle("thinking");
    store.startWaiting(0);
    store.streamText("thinking", "a\nb\nc");
    expect(committed(store)).toEqual([]);
    store.endReply();
    expect(committed(store)).toEqual(["∴ thinking · 5 chars hidden"]);
  });

  it("writes nothing for a reply with no text", () => {
    const store = new RunStore();
    reply(store);
    expect(committed(store)).toEqual([]);
  });
});

describe("RunStore gates", () => {
  it("answers a gate inline and nests its tool line under it", () => {
    const store = new RunStore();
    reply(store, "Listing.");
    store.openGate(shellPrompt, ROOMY);
    expect(committed(store)).toEqual(["● Listing.", " "]);
    store.answerGate("y");
    readTool(store);
    expect(committed(store)).toEqual([
      "● Listing.",
      " ",
      "◇ Allow shell: ls? · yes",
      "│ $ ls",
      "  ✓ read: a.txt · 1 line",
    ]);
  });

  it("prints the question and preview first when the gate would not fit live", () => {
    const store = new RunStore();
    const preview = Array.from({ length: 10 }, (_, index) => `+row ${index}`).join("\n");
    store.openGate({ ...shellPrompt, preview }, 5);
    expect(committed(store)).toHaveLength(11);
    expect(committed(store)[0]).toBe("◆ Allow shell: ls?");
    store.answerGate("n");
    expect(committed(store).at(-1)).toBe("◇ Allow shell: ls? · no");
  });

  it("moves the selection and wraps around", () => {
    const store = new RunStore();
    store.openGate(shellPrompt, ROOMY);
    store.moveGateSelection(-1);
    expect(store.getSnapshot().live).toMatchObject({ kind: "gate", selected: 2 });
    store.moveGateSelection(1);
    expect(store.getSnapshot().live).toMatchObject({ kind: "gate", selected: 0 });
  });
});

describe("RunStore toggles and transcript", () => {
  it("lists tool output only after tool output is switched on", () => {
    const store = new RunStore();
    readTool(store, "a\n");
    store.toggle("toolOutput");
    readTool(store, "b\n");
    expect(committed(store)).toEqual([
      "  ✓ read: a.txt · 1 line",
      "  ✓ read: a.txt · 1 line",
      "  │ b",
    ]);
  });

  it("holds rows while the transcript is open and prints them when it closes", () => {
    const store = new RunStore();
    store.openTranscript();
    readTool(store);
    expect(committed(store)).toEqual([]);
    store.closeTranscript();
    expect(committed(store)).toEqual(["  ✓ read: a.txt · 1 line"]);
  });

  it("shows every block fully expanded in the transcript", () => {
    const store = new RunStore();
    store.toggle("thinking");
    store.startWaiting(0);
    store.streamText("thinking", "Hmm");
    store.endReply();
    readTool(store, "a\n");
    expect(linesText(store.transcriptLines())).toEqual([
      "∴ Hmm",
      " ",
      "  ✓ read: a.txt · 1 line",
      "  │ a",
    ]);
  });

  it("marks the view finished so the footer can go", () => {
    const store = new RunStore();
    store.finish();
    expect(store.getSnapshot().finished).toBe(true);
  });
});
