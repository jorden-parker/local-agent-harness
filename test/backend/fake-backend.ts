import type { Backend, ChatChunk, ChatRequest } from "../../src/backend/backend.js";

export class FakeBackend implements Backend {
  readonly requests: ChatRequest[] = [];

  constructor(private readonly turns: ChatChunk[][]) {}

  async *chat(request: ChatRequest): AsyncIterable<ChatChunk> {
    this.requests.push(structuredClone(request));
    const turn = this.turns.shift();
    if (turn === undefined) throw new Error("FakeBackend has no scripted turn left");
    yield* turn;
    await Promise.resolve();
  }
}
