import { describe, expect, it } from "vitest";
import { parseOllamaLine } from "../../src/backend/ollama-chunks.js";

describe("parseOllamaLine", () => {
  it("yields text for content chunks", () => {
    const line = JSON.stringify({ message: { role: "assistant", content: "Hi" }, done: false });
    expect(parseOllamaLine(line)).toEqual([{ type: "text", text: "Hi" }]);
  });

  it("yields tool calls with parsed arguments", () => {
    const line = JSON.stringify({
      message: {
        role: "assistant",
        content: "",
        tool_calls: [
          { id: "call_1", function: { index: 0, name: "read", arguments: { path: "a" } } },
        ],
      },
      done: false,
    });
    expect(parseOllamaLine(line)).toEqual([
      { type: "tool_call", call: { id: "call_1", name: "read", arguments: { path: "a" } } },
    ]);
  });

  it("drops unknown tool names", () => {
    const line = JSON.stringify({
      message: {
        role: "assistant",
        content: "",
        tool_calls: [{ function: { name: "nuke", arguments: {} } }],
      },
    });
    expect(parseOllamaLine(line)).toEqual([]);
  });

  it("ignores empty content and blank lines", () => {
    expect(parseOllamaLine("")).toEqual([]);
    expect(parseOllamaLine(JSON.stringify({ message: { content: "" }, done: true }))).toEqual([]);
  });

  it("throws on an error payload", () => {
    expect(() => parseOllamaLine(JSON.stringify({ error: "model not found" }))).toThrow(
      /model not found/,
    );
  });
});
