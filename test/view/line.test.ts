import { describe, expect, it } from "vitest";
import { blankLinesBefore } from "../../src/view/line.js";

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
