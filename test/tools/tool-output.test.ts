import { describe, expect, it } from "vitest";
import { truncateToolOutput } from "../../src/tools/tool-output.js";

describe("truncateToolOutput", () => {
  it("leaves short output alone", () => {
    expect(truncateToolOutput("hello")).toBe("hello");
  });

  it("caps line count", () => {
    const lines = Array.from({ length: 2500 }, (_, i) => `line ${i}`).join("\n");
    const result = truncateToolOutput(lines);
    expect(result.split("\n")).toHaveLength(2001);
    expect(result).toMatch(/truncated 500 lines/);
  });

  it("caps byte size", () => {
    const result = truncateToolOutput("x".repeat(60_000));
    expect(result.length).toBeLessThan(51_000);
    expect(result).toMatch(/truncated/);
  });
});
