import { describe, expect, it } from "vitest";
import { chooseModel } from "../../src/config/model-choice.js";

describe("chooseModel", () => {
  it("prefers the --model flag", () => {
    expect(chooseModel("qwen3.8:27b", "qwen3:4b-instruct-2507-q4_K_M")).toBe("qwen3.8:27b");
  });

  it("falls back to the machine's defaultModel", () => {
    expect(chooseModel(undefined, "qwen3:4b-instruct-2507-q4_K_M")).toBe(
      "qwen3:4b-instruct-2507-q4_K_M",
    );
  });

  it("falls back to qwen3:8b when nothing is set", () => {
    expect(chooseModel(undefined, undefined)).toBe("qwen3:8b");
  });
});
