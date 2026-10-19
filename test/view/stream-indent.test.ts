import { describe, expect, it } from "vitest";
import { indentStream } from "../../src/view/stream-indent.js";

describe("indentStream", () => {
  it.each([
    { text: "Hi", atLineStart: true, expected: { text: "  Hi", atLineStart: false } },
    { text: " there", atLineStart: false, expected: { text: " there", atLineStart: false } },
    { text: "a\nb", atLineStart: false, expected: { text: "a\n  b", atLineStart: false } },
    { text: "a\n", atLineStart: true, expected: { text: "  a\n", atLineStart: true } },
    { text: "\n\nx", atLineStart: true, expected: { text: "\n\n  x", atLineStart: false } },
    { text: "", atLineStart: true, expected: { text: "", atLineStart: true } },
  ])("indents $text when atLineStart is $atLineStart", ({ text, atLineStart, expected }) => {
    expect(indentStream(text, atLineStart)).toEqual(expected);
  });
});
