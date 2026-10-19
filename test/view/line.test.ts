import { describe, expect, it } from "vitest";
import { blankLinesBefore, markedLines, REPLY_MARKER } from "../../src/view/line.js";
import { linesText } from "./line-text.js";

describe("blankLinesBefore", () => {
  it("puts nothing before the first block", () => {
    expect(blankLinesBefore(undefined, "header")).toBe(0);
  });

  it("nests a tool line under a reply, a tool line or a gate", () => {
    expect(blankLinesBefore("reply", "tool")).toBe(0);
    expect(blankLinesBefore("tool", "tool")).toBe(0);
    expect(blankLinesBefore("gate", "tool")).toBe(0);
  });

  it("puts one blank line between every other pair of blocks", () => {
    expect(blankLinesBefore("thinking", "tool")).toBe(1);
    expect(blankLinesBefore("reply", "reply")).toBe(1);
    expect(blankLinesBefore("tool", "gate")).toBe(1);
    expect(blankLinesBefore("header", "task")).toBe(1);
    expect(blankLinesBefore("tool", "summary")).toBe(1);
  });
});

describe("markedLines", () => {
  it("puts the marker on the first row and indents the rest to the text column", () => {
    expect(linesText(markedLines(REPLY_MARKER, "one\ntwo"))).toEqual(["● one", "  two"]);
  });

  it("keeps an empty row one space wide so it still takes a row", () => {
    expect(linesText(markedLines(REPLY_MARKER, "one\n\ntwo"))).toEqual(["● one", "   ", "  two"]);
  });

  it("keeps the marker and indent in the gutter so wrapped text hangs", () => {
    const [first, second] = markedLines(REPLY_MARKER, "one\ntwo");
    expect(first?.gutter.map((span) => span.text)).toEqual(["● "]);
    expect(second?.gutter.map((span) => span.text)).toEqual(["  "]);
  });
});
