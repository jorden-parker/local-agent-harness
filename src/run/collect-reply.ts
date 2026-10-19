import type { ChatChunk } from "../backend/backend.js";
import type { ToolCall } from "../tools/tool-call.js";

export interface AssistantReply {
  text: string;
  calls: ToolCall[];
}

const THINKING_CLOSE = "</think>";

export async function collectReply(
  chunks: AsyncIterable<ChatChunk>,
  out: (text: string) => void,
): Promise<AssistantReply> {
  let streamed = "";
  const calls: ToolCall[] = [];
  for await (const chunk of chunks) {
    if (chunk.type === "tool_call") {
      calls.push(chunk.call);
      continue;
    }
    streamed += chunk.text;
    out(chunk.text);
  }
  return { text: stripLeakedThinking(streamed), calls };
}

export function stripLeakedThinking(text: string): string {
  const closeAt = text.lastIndexOf(THINKING_CLOSE);
  return closeAt === -1 ? text : text.slice(closeAt + THINKING_CLOSE.length).trimStart();
}
