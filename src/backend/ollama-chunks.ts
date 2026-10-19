import { isToolName, type ToolCall } from "../tools/tool-call.js";
import type { ChatChunk } from "./backend.js";

interface OllamaToolCall {
  id?: string;
  function: { name: string; arguments: Record<string, unknown> };
}

interface OllamaLine {
  error?: string;
  message?: { content?: string; tool_calls?: OllamaToolCall[] };
}

export function parseOllamaLine(line: string): ChatChunk[] {
  if (line.trim() === "") return [];
  const parsed = JSON.parse(line) as OllamaLine;
  if (parsed.error !== undefined) throw new Error(`Ollama error: ${parsed.error}`);
  const message = parsed.message ?? {};
  const chunks: ChatChunk[] = [];
  if (message.content) chunks.push({ type: "text", text: message.content });
  for (const raw of message.tool_calls ?? []) {
    const call = toToolCall(raw, chunks.length);
    if (call !== null) chunks.push({ type: "tool_call", call });
  }
  return chunks;
}

function toToolCall(raw: OllamaToolCall, index: number): ToolCall | null {
  if (!isToolName(raw.function.name)) return null;
  return {
    id: raw.id ?? `call_${index}`,
    name: raw.function.name,
    arguments: raw.function.arguments,
  };
}
