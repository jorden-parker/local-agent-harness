import type { ToolCall } from "../tools/toolCall.js";

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: ToolCall[] }
  | { role: "tool"; content: string; tool_name: string };

export interface ToolDefinition {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools: ToolDefinition[];
  think: boolean;
  numCtx: number;
}

export type ChatChunk = { type: "text"; text: string } | { type: "tool_call"; call: ToolCall };

export interface Backend {
  chat(request: ChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk>;
}
