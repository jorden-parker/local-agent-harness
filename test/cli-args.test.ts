import { describe, expect, it } from "vitest";
import { parseCliArgs } from "../src/cli-args.js";

describe("parseCliArgs", () => {
  it("uses safe defaults", () => {
    const args = parseCliArgs(["fix", "the", "tests"]);
    expect(args.task).toBe("fix the tests");
    expect(args.model).toBeUndefined();
    expect(args.runOptions.flags).toEqual({ yolo: false, allowSecrets: false });
    expect(args.runOptions.numCtx).toBe(32768);
    expect(args.runOptions.think).toBe(false);
  });

  it("requires a task", () => {
    expect(() => parseCliArgs(["--yolo"])).toThrow(/usage/);
  });

  it("rejects bad numbers", () => {
    expect(() => parseCliArgs(["t", "--num-ctx", "lots"])).toThrow(/--num-ctx/);
  });
});
