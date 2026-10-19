import type { Backend, ChatChunk, ChatRequest } from "./backend.js";
import { parseOllamaLine } from "./ollama-chunks.js";

export class OllamaBackend implements Backend {
  constructor(private readonly baseUrl: string) {}

  async *chat(request: ChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(toOllamaBody(request)),
      signal,
    });
    if (!response.ok || response.body === null) {
      throw new Error(`Ollama responded ${response.status}: ${await response.text()}`);
    }
    for await (const line of ndjsonLines(response.body)) yield* parseOllamaLine(line);
  }
}

function toOllamaBody(request: ChatRequest): Record<string, unknown> {
  return {
    model: request.model,
    messages: request.messages,
    tools: request.tools,
    stream: true,
    think: request.think,
    options: { num_ctx: request.numCtx },
  };
}

async function* ndjsonLines(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const decoder = new TextDecoder();
  let buffered = "";
  for await (const bytes of body) {
    buffered += decoder.decode(bytes, { stream: true });
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    yield* lines;
  }
  yield buffered;
}
