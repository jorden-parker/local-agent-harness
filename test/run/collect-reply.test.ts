import { describe, expect, it } from "vitest";
import type { ChatChunk } from "../../src/backend/backend.js";
import { collectReply } from "../../src/run/collect-reply.js";

function recordingStream(output: string[], thoughts: string[] = []) {
  return {
    replyText: (text: string) => output.push(text),
    thinkingText: (text: string) => thoughts.push(text),
  };
}

async function* chunks(...items: ChatChunk[]): AsyncIterable<ChatChunk> {
  yield* items;
  await Promise.resolve();
}

describe("collectReply", () => {
  it("streams text to the output and gathers tool calls", async () => {
    const output: string[] = [];
    const reply = await collectReply(
      chunks(
        { type: "text", text: "Hi " },
        { type: "text", text: "there" },
        { type: "tool_call", call: { id: "1", name: "read", arguments: {} } },
      ),
      recordingStream(output),
    );
    expect(reply.text).toBe("Hi there");
    expect(reply.calls).toHaveLength(1);
    expect(output.join("")).toBe("Hi there");
  });

  it("drops leaked thinking from the stored text but still streams it", async () => {
    const output: string[] = [];
    const reply = await collectReply(
      chunks({ type: "text", text: "Let me think.\n</think>\n\nDone." }),
      recordingStream(output),
    );
    expect(reply.text).toBe("Done.");
    expect(output.join("")).toContain("Let me think.");
  });

  it("streams thinking apart from the reply text", async () => {
    const output: string[] = [];
    const thoughts: string[] = [];
    const reply = await collectReply(
      chunks({ type: "thinking", text: "Hmm" }, { type: "text", text: "Hi" }),
      recordingStream(output, thoughts),
    );
    expect(reply.text).toBe("Hi");
    expect(thoughts).toEqual(["Hmm"]);
    expect(output).toEqual(["Hi"]);
  });
});
