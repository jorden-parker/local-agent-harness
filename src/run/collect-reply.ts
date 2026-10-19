import type { ChatChunk } from "../backend/backend.js";
import type { ToolCall } from "../tools/tool-call.js";
import type { RunView } from "../view/run-view.js";

export interface AssistantReply {
  text: string;
  calls: ToolCall[];
}

type ReplyStream = Pick<RunView, "replyText" | "thinkingText">;

const THINKING_CLOSE = "</think>";

export async function collectReply(
  chunks: AsyncIterable<ChatChunk>,
  stream: ReplyStream,
): Promise<AssistantReply> {
  let streamed = "";
  const calls: ToolCall[] = [];
  for await (const chunk of chunks) {
    if (chunk.type === "tool_call") calls.push(chunk.call);
    if (chunk.type === "thinking") stream.thinkingText(chunk.text);
    if (chunk.type !== "text") continue;
    streamed += chunk.text;
    stream.replyText(chunk.text);
  }
  return { text: stripLeakedThinking(streamed), calls };
}

function stripLeakedThinking(text: string): string {
  const closeAt = text.lastIndexOf(THINKING_CLOSE);
  return closeAt === -1 ? text : text.slice(closeAt + THINKING_CLOSE.length).trimStart();
}
