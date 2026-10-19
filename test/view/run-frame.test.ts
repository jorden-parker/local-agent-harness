import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import { formatRunHeader, formatRunSummary, ruleWidth } from "../../src/view/run-frame.js";

const plain = (text: string): string => stripVTControlCharacters(text);

describe("formatRunHeader", () => {
  it("shows the model, log, rule and task", () => {
    const header = formatRunHeader(
      { model: "m", backendUrl: "http://h", logPath: "/l.jsonl", task: "do it" },
      10,
    );
    expect(plain(header)).toBe("harness · m via http://h\nlog /l.jsonl\n──────────\n> do it\n\n");
  });
});

describe("formatRunSummary", () => {
  it("shows a final answer with seconds", () => {
    const summary = formatRunSummary(
      { endReason: "model gave a final answer", iterations: 1 },
      4_400,
      3,
    );
    expect(plain(summary)).toBe("\n───\n✓ model gave a final answer · 1 tool call · 4s\n");
  });

  it("shows a stopped run with minutes and padded seconds", () => {
    const summary = formatRunSummary(
      { endReason: "iteration cap reached", iterations: 50 },
      125_000,
      3,
    );
    expect(plain(summary)).toBe("\n───\n! iteration cap reached · 50 tool calls · 2m 05s\n");
  });
});

describe("ruleWidth", () => {
  it("caps the rule at 60 columns and defaults to 60", () => {
    expect(ruleWidth(undefined)).toBe(60);
    expect(ruleWidth(200)).toBe(60);
    expect(ruleWidth(40)).toBe(40);
  });
});
