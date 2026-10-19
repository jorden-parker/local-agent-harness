import { describe, expect, it } from "vitest";
import { countRows } from "../../src/view/terminal-rows.js";

describe("countRows", () => {
  it("counts one row per line, empty lines included", () => {
    expect(countRows("a\n\nb\n", 80)).toBe(3);
  });

  it("counts the extra rows a long line wraps onto", () => {
    expect(countRows(`${"x".repeat(25)}\n`, 10)).toBe(3);
  });

  it("ignores colour codes when measuring width", () => {
    expect(countRows(`\u001b[32m${"x".repeat(10)}\u001b[39m\n`, 10)).toBe(1);
  });
});
