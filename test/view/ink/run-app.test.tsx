import { renderToString } from "ink";
import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import type { ToolCall } from "../../../src/tools/tool-call.js";
import { Footer } from "../../../src/view/ink/footer.js";
import { LineView } from "../../../src/view/ink/line-view.js";
import { RunApp } from "../../../src/view/ink/run-app.js";
import { Transcript } from "../../../src/view/ink/transcript.js";
import { markedLines, REPLY_MARKER } from "../../../src/view/line.js";
import { RunStore } from "../../../src/view/run-store.js";

const readCall: ToolCall = { id: "1", name: "read", arguments: { path: "a.txt" } };
const shown = (text: string): string[] =>
  stripVTControlCharacters(text)
    .split("\n")
    .map((row) => row.trimEnd());
const noInput = (): void => undefined;

describe("LineView", () => {
  it("hangs wrapped text at the text column", () => {
    const [line] = markedLines(REPLY_MARKER, "alpha beta gamma delta epsilon");
    const output = line
      ? renderToString(<LineView line={line} columns={16} />, { columns: 16 })
      : "";
    expect(shown(output)).toEqual(["● alpha beta", "  gamma delta", "  epsilon"]);
  });
});

describe("Footer", () => {
  it("lists the gate keys before the toggles while a gate is open", () => {
    const store = new RunStore();
    store.openGate({ question: "Allow shell: ls?", preview: "$ ls", toolName: "shell" }, 40);
    const output = renderToString(<Footer state={store.getSnapshot()} />, { columns: 200 });
    expect(shown(output).join("\n")).toContain(
      "y yes   n no   a allow every shell   esc counts as no   t thinking on",
    );
  });
});

describe("Transcript", () => {
  it("shows tool output even when the toggle is off", () => {
    const store = new RunStore();
    store.addBlock({ kind: "tool", call: readCall, outcome: { ok: true, output: "hello\n" } });
    const transcript = (
      <Transcript lines={store.transcriptLines()} top={0} terminalRows={20} columns={60} />
    );
    expect(shown(renderToString(transcript, { columns: 60 }))).toContain("  │ hello");
  });
});

describe("RunApp", () => {
  it("prints committed rows and leaves the footer out when not interactive", () => {
    const store = new RunStore();
    store.addBlock({ kind: "reply", text: "Done." });
    const app = (
      <RunApp
        store={store}
        interactive={false}
        terminalRows={() => 30}
        terminalColumns={() => 60}
        onInput={noInput}
      />
    );
    expect(shown(renderToString(app, { columns: 60 }))).toEqual(["● Done."]);
  });
});
