import { describe, expect, it } from "vitest";
import { markedLines, REPLY_MARKER, type Line } from "../../src/view/line.js";
import { wrapLine } from "../../src/view/wrap-line.js";
import { linesText } from "./line-text.js";

const reply = (text: string): Line =>
  markedLines(REPLY_MARKER, text)[0] ?? { gutter: [], body: [] };

describe("wrapLine", () => {
  it("leaves a row that fits alone", () => {
    expect(linesText(wrapLine(reply("short"), 20))).toEqual(["● short"]);
  });

  it("hangs continuation rows under the text and drops the space it broke on", () => {
    expect(linesText(wrapLine(reply("alpha beta gamma delta"), 14))).toEqual([
      "● alpha beta",
      "  gamma delta",
    ]);
  });

  it("breaks a word longer than the row", () => {
    expect(linesText(wrapLine(reply("abcdefghij"), 6))).toEqual(["● abcd", "  efgh", "  ij"]);
  });

  it("keeps each span's style across the break", () => {
    const line: Line = {
      gutter: [],
      body: [
        { text: "aaa ", color: "red" },
        { text: "bbb", color: "green" },
      ],
    };
    const [first, second] = wrapLine(line, 4);
    expect(first?.body).toEqual([{ text: "aaa", color: "red" }]);
    expect(second?.body).toEqual([{ text: "bbb", color: "green" }]);
  });

  it("keeps the band on every wrapped row", () => {
    const band: Line = { ...reply("one two three"), band: true };
    expect(wrapLine(band, 8).every((row) => row.band === true)).toBe(true);
  });
});
