# Plan 002: Show context-window use per reply and end clearly when the window overflows

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat d56080c..HEAD -- src/backend src/run/collect-reply.ts src/run/run-loop.ts src/view test/backend test/run test/view test/live README.md`
> If any in-scope file changed since this plan was written, compare every
> "Current state" excerpt below against the live file; on any mismatch, STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW (adds data and one warning line; loop rules unchanged)
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `d56080c`, 2026-10-19
- **Refreshed**: 2026-10-19 by `/improve reconcile` — first written at `9d2cb42`; retargeted from the deleted `terminal-run-view.ts` to the Ink view (`InkRunView` + a new `context` Block); finding re-verified as still present.

## Why this matters

The harness drives small local models through Ollama with `--num-ctx` defaulting to 32768 tokens. A single tool result may be up to 50 KB (about 12K tokens), and the conversation grows every turn, so a Run can fill the window after two or three large reads. Today the user cannot see how full the window is. When it overflows, Ollama 0.33 rejects the request with HTTP 400 and the Run ends with a raw nested-JSON error string.

After this plan, each reply's token counts are recorded in the Run log, the terminal shows a dim warning line once a reply uses 80% or more of the window, and an overflow ends the Run with a one-line reason that names the numbers and the `--num-ctx` flag. This is the measurement step. Compaction and ranged reads are plan 007, which builds on the `usage` this plan parses.

## Current state

### Verified Ollama behaviour (Ollama 0.33.2, measured 2026-10-19)

- The last NDJSON line of a streaming `/api/chat` response has `"done": true` and integer fields `prompt_eval_count` (prompt tokens) and `eval_count` (generated tokens). Example (trimmed):
  `{"message":{"role":"assistant","content":""},"done":true,"done_reason":"stop","prompt_eval_count":11,"eval_count":12}`
- A repeated identical request still reports the full `prompt_eval_count` (KV-cache hits do not shrink it).
- A prompt larger than `num_ctx` is **not** silently truncated. The response is HTTP 400 with this body:
  `{"error":"{\"error\":{\"code\":400,\"message\":\"request (6012 tokens) exceeds the available context size (4096 tokens), try increasing it\",\"type\":\"exceed_context_size_error\",\"n_prompt_tokens\":6012,\"n_ctx\":4096}}"}`
  Note that the outer `error` value is itself a JSON **string**.

### Files and roles

- `src/backend/backend.ts` — `ChatChunk` union and `Backend` interface.
- `src/backend/ollama-chunks.ts` — `parseOllamaLine(line)` turns one NDJSON line into `ChatChunk[]`. It ignores `done`, `prompt_eval_count` and `eval_count` today.
- `src/backend/ollama-backend.ts` — `OllamaBackend.chat`; throws `Ollama responded <status>: <body>` on a non-OK response.
- `src/run/collect-reply.ts` — consumes chunks. It handles `tool_call` and `thinking`, and treats everything else that is not `text` as ignorable (`if (chunk.type !== "text") continue;`). A new chunk type is therefore silently dropped unless this file handles it.
- `src/run/run-loop.ts` — the Harness loop; `oneTurn` calls `collectReply`, then logs `{ event: "assistant", text, calls }`.
- `src/view/run-view.ts` — `RunView` interface. The only production implementation is `InkRunView` in `src/view/ink-run-view.tsx`, which forwards to `RunStore` (`src/view/run-store.ts`).
- `src/view/block-lines.ts` — the `Block` union and one pure renderer per block kind (`BLOCK_RENDERERS`), turning a block into `Line[]`.
- `src/view/line.ts` — the `Line`/`Span` model, `BlockKind`, spacing rules (`blankLinesBefore`).
- `test/view/recording-view.ts` — the `RunView` test double used by `test/run/run-loop.test.ts`.
- `test/live/ollama.live.test.ts` — builds an inline `RunView` object literal; it must gain any new `RunView` method or `pnpm typecheck` fails.

### Excerpts

`src/backend/backend.ts:21-24`:

```ts
export type ChatChunk =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_call"; call: ToolCall };
```

`src/backend/ollama-chunks.ts:9-27`:

```ts
interface OllamaLine {
  error?: string;
  message?: { thinking?: string; content?: string; tool_calls?: OllamaToolCall[] };
}

export function parseOllamaLine(line: string): ChatChunk[] {
  if (line.trim() === "") return [];
  const parsed = JSON.parse(line) as OllamaLine;
  if (parsed.error !== undefined) throw new Error(`Ollama error: ${parsed.error}`);
  const message = parsed.message ?? {};
  const chunks: ChatChunk[] = [];
  if (message.thinking) chunks.push({ type: "thinking", text: message.thinking });
  if (message.content) chunks.push({ type: "text", text: message.content });
  for (const raw of message.tool_calls ?? []) {
    const call = toToolCall(raw, chunks.length);
    if (call !== null) chunks.push({ type: "tool_call", call });
  }
  return chunks;
}
```

`src/backend/ollama-backend.ts:7-18`:

```ts
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
```

`src/run/collect-reply.ts:5-28`:

```ts
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
```

`src/run/run-loop.ts:83-88` (inside `oneTurn`):

```ts
deps.view.replyStarted();
const reply = await collectReply(deps.backend.chat(request, signal), deps.view);
deps.view.replyEnded();
messages.push({ role: "assistant", content: reply.text, tool_calls: reply.calls });
await deps.log.record({ event: "assistant", text: reply.text, calls: reply.calls });
if (reply.calls.length === 0) return { ...state, endReason: FINAL_ANSWER_REASON };
```

`src/view/run-view.ts` (whole file):

```ts
import type { ToolOutcome } from "../tools/execute-tool.js";
import type { ToolCall } from "../tools/tool-call.js";

export interface RunView {
  replyStarted(): void;
  thinkingText(text: string): void;
  replyText(text: string): void;
  replyEnded(): void;
  confirmationStarted(): void;
  toolFinished(call: ToolCall, outcome: ToolOutcome): void;
}
```

`src/view/ink-run-view.tsx:95-105`:

```tsx
  replyEnded(): void {
    this.store.endReply();
  }

  confirmationStarted(): void {
    this.store.endReply();
  }

  toolFinished(call: ToolCall, outcome: ToolOutcome): void {
    this.store.addBlock({ kind: "tool", call, outcome });
  }
```

`src/view/block-lines.ts:28-62` (the `Block` union and its renderer table):

```ts
export type Block =
  | {
      kind: "header";
      model: string;
      backendUrl: string;
      logPath: string;
      think: boolean;
      width: number;
    }
  | { kind: "task"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "reply"; text: string }
  | { kind: "tool"; call: ToolCall; outcome: ToolOutcome }
  | { kind: "gate"; prompt: GatePrompt; choice: ConfirmationChoice; previewCommitted: boolean }
  | { kind: "summary"; endReason: string; iterations: number; elapsedMs: number; width: number };

...

const BLOCK_RENDERERS: BlockRenderers = {
  header: headerLines,
  task: (block) => taskLines(block.text),
  thinking: (block, toggles, columns) => thinkingLines(block.text, toggles.thinking, columns),
  reply: (block, _toggles, columns) => markdownLines(REPLY_MARKER, block.text, {}, columns),
  tool: (block, toggles) => toolLines(block, toggles.toolOutput),
  gate: gateLines,
  summary: summaryLines,
};
```

`src/view/block-lines.ts:173-178` (the existing yellow `!` warning style to mirror):

```ts
function summaryLines(block: BlockOf<"summary">): Line[] {
  const finished = block.endReason === FINAL_ANSWER_REASON;
  const marker: Span = finished ? { text: "✓ ", color: "green" } : { text: "! ", color: "yellow" };
  const detail = `${block.endReason} · ${countLabel(block.iterations, "tool call")} · ${formatDuration(block.elapsedMs)}`;
  return [rule(block.width), { gutter: [marker], body: [{ text: detail }] }];
}
```

`src/view/line.ts:18` and `:36-42`:

```ts
export type BlockKind = "header" | "task" | "thinking" | "reply" | "tool" | "gate" | "summary";
```

```ts
const BLOCKS_THAT_NEST_TOOL_LINES: ReadonlySet<BlockKind> = new Set(["reply", "tool", "gate"]);

export function blankLinesBefore(previous: BlockKind | undefined, next: BlockKind): number {
  if (previous === undefined) return 0;
  if (next === "tool" && BLOCKS_THAT_NEST_TOOL_LINES.has(previous)) return 0;
  return SPACING.blankLinesBetweenBlocks;
}
```

`test/live/ollama.live.test.ts:47-54`:

```ts
          view: {
            replyStarted: () => undefined,
            thinkingText: () => undefined,
            replyText: () => undefined,
            replyEnded: () => undefined,
            confirmationStarted: () => undefined,
            toolFinished: () => undefined,
          },
```

### Conventions to match

- The view is a pure model: `block-lines.ts` turns a `Block` into `Line[]` (arrays of `Span`s with `color`/`dim`/`bold`), and Ink only paints lines. Never import `picocolors` or write ANSI into view code; use `Span` fields. Indented lines under a reply use `gutter: [INDENT, marker]`, as `toolLine` does.
- View tests assert on plain text through `linesText` from `test/view/line-text.ts`; see `test/view/block-lines.test.ts` (`shown(...)` helper) and `test/view/run-store.test.ts` (`committed(store)` helper).
- Kebab-case file names, ESM imports with `.js` suffix, strict TS with `exactOptionalPropertyTypes` (use `| null`, not optional fields, for "maybe absent" data — as `endReason: string | null` does in `src/run/run-state.ts`).
- **No code comments of any kind**, including lint suppressions. A hook rejects them.
- Tests: Vitest, `describe`/`it`, one test file per source file under `test/` mirroring `src/`. `test/backend/ollama-chunks.test.ts` is the pattern for parser tests.
- Glossary terms (from `GLOSSARY.md`): **Run**, **Model**, **Backend**, **Tool Call**. Do not use "session" or "LLM" in names or user-facing strings.

## Commands you will need

| Purpose   | Command                                      | Expected on success           |
| --------- | -------------------------------------------- | ----------------------------- |
| Typecheck | `pnpm typecheck`                             | exit 0                        |
| Tests     | `pnpm test`                                  | all pass                      |
| One dir   | `pnpm vitest run test/backend`               | all pass                      |
| Lint      | `pnpm lint`                                  | exit 0                        |
| All gates | `.claude/verify`                             | exit 0                        |
| Dead code | `npx fallow --format json`                   | `total_issues` 0              |
| Live      | `pnpm test:live` (needs Ollama on localhost) | pass, or skipped if no Ollama |

Baseline at `d56080c`: typecheck, lint and 134 tests in 21 files pass; Fallow reports 0 issues.

## Scope

**In scope**:

- `src/backend/backend.ts`
- `src/backend/ollama-chunks.ts`
- `src/backend/ollama-backend.ts`
- `src/backend/ollama-error.ts` (create)
- `src/run/collect-reply.ts`
- `src/run/run-loop.ts`
- `src/view/run-view.ts`
- `src/view/ink-run-view.tsx`
- `src/view/block-lines.ts`
- `src/view/line.ts`
- `src/view/context-warning.ts` (create)
- `test/backend/ollama-chunks.test.ts`
- `test/backend/ollama-error.test.ts` (create)
- `test/run/collect-reply.test.ts`
- `test/run/run-loop.test.ts`
- `test/view/recording-view.ts`
- `test/view/context-warning.test.ts` (create)
- `test/view/block-lines.test.ts`
- `test/view/line.test.ts`
- `test/view/run-store.test.ts`
- `test/live/ollama.live.test.ts`
- `README.md` (one bullet, Step 8)

**Out of scope**:

- `src/tools/tool-output.ts` caps and `readTool` ranges — plan 007 changes what goes into the window.
- Any compaction or dropping of old messages (plan 007).
- `src/view/run-store.ts` — `addBlock` already handles any `Block`; do not add a store method.
- `src/view/ink/*.tsx` and `src/view/live-lines.ts` — the warning is a committed block, not live content.
- The `summary` block — keep the end-of-Run summary as is.
- `src/run/run-state.ts` — usage does not affect loop rules.

## Git workflow

- Branch: `advisor/002-context-window-usage`.
- Conventional commits (commitlint enforces), e.g. `feat: record token usage per reply`. Recent history: `feat: box tables and highlight code blocks`, `feat: port the RunView to Ink with toggles and a transcript`.
- Pre-commit runs eslint `--max-warnings=0` and prettier on staged files.
- Do not push or open a PR unless the operator told you to.

## Steps

### Step 1: Add a `usage` chunk to the Backend contract and parse it

In `src/backend/backend.ts` add:

```ts
export interface TokenUsage {
  promptTokens: number;
  outputTokens: number;
}
```

and extend the union with a fourth member:

```ts
  | { type: "usage"; usage: TokenUsage };
```

In `src/backend/ollama-chunks.ts` extend `OllamaLine` with `done?: boolean; prompt_eval_count?: number; eval_count?: number;`. After the tool-call loop, when `parsed.done === true` and `typeof parsed.prompt_eval_count === "number"`, push `{ type: "usage", usage: { promptTokens: parsed.prompt_eval_count, outputTokens: parsed.eval_count ?? 0 } }`. Keep `parseOllamaLine` short: put the check in a helper `usageChunks(parsed: OllamaLine): ChatChunk[]` and spread its result.

Write the tests first in `test/backend/ollama-chunks.test.ts`:

- a done line with both counts (`{ message: { content: "" }, done: true, prompt_eval_count: 11, eval_count: 12 }`) yields exactly `[{ type: "usage", usage: { promptTokens: 11, outputTokens: 12 } }]`;
- a done line without `prompt_eval_count` yields `[]`.

The existing test `"ignores empty content and blank lines"` passes `{ message: { content: "" }, done: true }` with no counts and must still return `[]`.

**Verify**: `pnpm vitest run test/backend/ollama-chunks.test.ts` → all pass, including 2 new tests. `pnpm typecheck` → exit 0 (`collect-reply.ts` already skips unknown chunk types, so nothing breaks yet).

### Step 2: Carry usage through `collectReply`

In `src/run/collect-reply.ts`:

- import `TokenUsage` alongside `ChatChunk`;
- add `usage: TokenUsage | null` to `AssistantReply`;
- declare `let usage: TokenUsage | null = null;` next to `streamed`;
- in the loop add `if (chunk.type === "usage") usage = chunk.usage;` next to the other two `if` lines, before the `continue`;
- return `{ text: stripLeakedThinking(streamed), calls, usage }`.

Add a test in `test/run/collect-reply.test.ts` that a `usage` chunk ends up in `reply.usage` and never reaches the `output` array. Add a second assertion (or test) that a reply without a usage chunk has `usage: null`. Follow the existing tests, which use the `chunks(...)` async-generator helper and `recordingStream(output)`.

**Verify**: `pnpm typecheck` → exit 0. `pnpm vitest run test/run/collect-reply.test.ts` → all pass.

### Step 3: Decide when to warn (pure function)

Create `src/view/context-warning.ts`:

```ts
import type { TokenUsage } from "../backend/backend.js";

export const CONTEXT_WARNING_RATIO = 0.8;

export function contextWarning(usage: TokenUsage, numCtx: number): string | null {
  const used = usage.promptTokens + usage.outputTokens;
  if (used < numCtx * CONTEXT_WARNING_RATIO) return null;
  const percent = Math.round((used / numCtx) * 100);
  return `context ${used} of ${numCtx} tokens (${percent}%); raise --num-ctx if the Run fails`;
}
```

Tests in `test/view/context-warning.test.ts`:

- promptTokens 800, outputTokens 8, numCtx 1024 (78.9%) → `null`;
- promptTokens 800, outputTokens 19, numCtx 1024 (819 tokens, just below the 819.2 threshold) → `null`;
- promptTokens 800, outputTokens 20, numCtx 1024 → exactly `"context 820 of 1024 tokens (80%); raise --num-ctx if the Run fails"`;
- promptTokens 2000, outputTokens 48, numCtx 1024 → a string containing `(200%)`.

**Verify**: `pnpm vitest run test/view/context-warning.test.ts` → all pass.

### Step 4: Add a `context` Block and its renderer

In `src/view/line.ts`:

- add `"context"` to the `BlockKind` union;
- add `"context"` to `BLOCKS_THAT_NEST_TOOL_LINES` (so a tool line after the warning stays nested, with no blank line);
- replace the nesting rule so a context line also nests under a reply:

```ts
const NESTED_BLOCKS: ReadonlySet<BlockKind> = new Set(["tool", "context"]);
```

and in `blankLinesBefore` change `next === "tool"` to `NESTED_BLOCKS.has(next)`. Rename `BLOCKS_THAT_NEST_TOOL_LINES` to `BLOCKS_THAT_NEST_LINES` while you are there, since it now nests both kinds.

In `src/view/block-lines.ts`:

- add `| { kind: "context"; text: string }` to the `Block` union (place it after the `tool` member);
- add `context: (block) => contextLines(block.text),` to `BLOCK_RENDERERS` (TypeScript will refuse to compile until you do, because `BlockRenderers` is a mapped type over every kind);
- add:

```ts
function contextLines(text: string): Line[] {
  return [{ gutter: [INDENT, { text: "! ", color: "yellow" }], body: [{ text, dim: true }] }];
}
```

Tests:

- `test/view/block-lines.test.ts`: a new `describe("context block", ...)` with one test: `shown({ kind: "context", text: "context 900 of 1024 tokens (88%)" })` equals `["  ! context 900 of 1024 tokens (88%)"]`.
- `test/view/line.test.ts`: in `"nests a tool line under a reply, a tool line or a gate"`, or a new `it`, assert `blankLinesBefore("reply", "context")` is `0` and `blankLinesBefore("context", "tool")` is `0`. The existing assertions must keep passing unchanged.
- `test/view/run-store.test.ts`: one test, patterned on `"nests tool lines under a reply and separates replies by one blank line"`: `reply(store, "First.")`, `store.addBlock({ kind: "context", text: "context 900 of 1024 tokens (88%)" })`, `readTool(store)`, then `committed(store)` equals `["● First.", "  ! context 900 of 1024 tokens (88%)", "  ✓ read: a.txt · 1 line"]`.

**Verify**: `pnpm typecheck` → exit 0. `pnpm vitest run test/view` → all pass.

### Step 5: Add `contextUsed` to `RunView` and implement it

- `src/view/run-view.ts`: import `TokenUsage` from `../backend/backend.js` and add `contextUsed(usage: TokenUsage, numCtx: number): void;` as the last method.
- `src/view/ink-run-view.tsx`: import `contextWarning` from `./context-warning.js` and `TokenUsage`; add after `toolFinished`:

```tsx
  contextUsed(usage: TokenUsage, numCtx: number): void {
    const warning = contextWarning(usage, numCtx);
    if (warning !== null) this.store.addBlock({ kind: "context", text: warning });
  }
```

- `test/view/recording-view.ts`: import `TokenUsage` and add a method that pushes `` `context:${usage.promptTokens + usage.outputTokens}/${numCtx}` ``.
- `test/live/ollama.live.test.ts`: add `contextUsed: () => undefined,` to the inline view literal, after `toolFinished`.

There is no `InkRunView` unit test today; do not create one. The rendering is covered by Step 4, and the call by Step 6.

**Verify**: `pnpm typecheck` → exit 0. `pnpm test` → all pass.

### Step 6: Call the view and log usage from the loop

In `src/run/run-loop.ts` `oneTurn`, right after `deps.view.replyEnded();`:

```ts
if (reply.usage !== null) deps.view.contextUsed(reply.usage, options.numCtx);
```

Change the assistant log record to `{ event: "assistant", text: reply.text, calls: reply.calls, usage: reply.usage }`.

Add a test in `test/run/run-loop.test.ts`. Script a `FakeBackend` turn `[text("Hi"), { type: "usage", usage: { promptTokens: 900, outputTokens: 10 } }]` (the `options()` helper already sets `numCtx: 1024`). Assert:

- `view.events` contains `"context:910/1024"`, and it comes after `"reply-ended"`;
- the `entries` item with `event: "assistant"` has `usage: { promptTokens: 900, outputTokens: 10 }`.

The existing test `"brackets each reply with replyStarted and replyEnded"` must still pass unchanged, because its turn has no usage chunk. If an existing test asserts the exact shape of an `assistant` log entry with `toEqual`, it will now need `usage: null`; that is an expected, in-scope edit — make it and mention it in your report.

**Verify**: `pnpm vitest run test/run` → all pass.

### Step 7: Turn Ollama's overflow error into a readable reason

Create `src/backend/ollama-error.ts` exporting `describeOllamaError(status: number, body: string): string`:

- Try to parse `body` as JSON. If the result has a string `error`, try to parse that string as JSON too. If the inner object has `error.type === "exceed_context_size_error"` with numeric `n_prompt_tokens` and `n_ctx`, return `` `context window full: request needs ${n_prompt_tokens} tokens, --num-ctx is ${n_ctx}` ``.
- In every other case, including any `JSON.parse` failure, return `` `Ollama responded ${status}: ${body}` ``, which is today's message.

Use small helpers (for example `parseJson(text): unknown` that returns `null` on failure, and `overflowCounts(value: unknown)`) rather than one long function. Do not use `any`; narrow `unknown` with `typeof` / `in` checks.

In `OllamaBackend.chat`, replace the template in the `throw` with `describeOllamaError(response.status, await response.text())`.

Tests in `test/backend/ollama-error.test.ts`:

- the exact overflow body from "Verified Ollama behaviour" above, status 400 → `context window full: request needs 6012 tokens, --num-ctx is 4096`;
- `{"error":"model not found"}` with status 404 → `Ollama responded 404: {"error":"model not found"}`;
- a non-JSON body `oops` with status 500 → `Ollama responded 500: oops`.

**Verify**: `pnpm vitest run test/backend` → all pass. The Run's end reason becomes `backend error: context window full: …` through the existing `errorMessage` in `run-loop.ts`; no loop change is needed.

### Step 8: Document and run the full gates

Add one bullet under README `## Known small-model quirks`: `- A reply that uses 80% of --num-ctx prints a "context" warning; Ollama rejects a prompt larger than --num-ctx, and the Run ends with "context window full".`

**Verify**: `.claude/verify` → exit 0. `npx fallow --format json` → `total_issues` 0.

### Step 9: Live check

If Ollama is reachable (`curl -s localhost:11434/api/tags` succeeds), run `pnpm test:live` and expect a pass. Then run the harness by hand in a real terminal on a scratch git repo with a tiny window to see both behaviours:

```sh
d=$(mktemp -d) && cd "$d" && git init -q && seq 1 4000 > big.txt && git add . && git commit -qm init
/Users/jorden/src/local-agent-harness/bin/harness.js --yolo --num-ctx 4096 --model qwen3:4b-instruct-2507-q4_K_M "read big.txt and tell me its last line"
```

**Expected**: a yellow `! context … tokens` line under a reply, or the Run summary ending with `! backend error: context window full: request needs N tokens, --num-ctx is 4096`. Paste the transcript tail into your report. If Ollama is not reachable, say so and skip this step.

## Test plan

New or changed tests: 2 in `ollama-chunks.test.ts`, 1–2 in `collect-reply.test.ts`, 4 in `context-warning.test.ts`, 1 in `block-lines.test.ts`, 1 in `line.test.ts`, 1 in `run-store.test.ts`, 1 in `run-loop.test.ts`, and 3 in `ollama-error.test.ts`. Model each on its neighbours in the same file. `pnpm test` must pass with all new tests.

## Done criteria

- [ ] `.claude/verify` exits 0
- [ ] `npx fallow --format json` reports `total_issues` 0
- [ ] `grep -n '"usage"' src/backend/backend.ts src/backend/ollama-chunks.ts src/run/collect-reply.ts` matches in all three files
- [ ] `grep -n "contextUsed" src/view/run-view.ts src/view/ink-run-view.tsx src/run/run-loop.ts test/view/recording-view.ts test/live/ollama.live.test.ts` matches in all five files
- [ ] `grep -n '"context"' src/view/line.ts src/view/block-lines.ts` matches in both
- [ ] `grep -rn "exceed_context_size_error" src/backend/ollama-error.ts` matches
- [ ] `grep -rn "picocolors" src/view` → no matches
- [ ] `git status` shows only in-scope files changed
- [ ] `plans/README.md` row 002 updated (unless your reviewer maintains the index)

## STOP conditions

- The excerpts above do not match the live files.
- `pnpm test:live` shows the done line has no `prompt_eval_count` on your Ollama version (check with `curl -s localhost:11434/api/chat -d '{"model":"<model>","messages":[{"role":"user","content":"hi"}]}' | tail -1`). Report the Ollama version.
- The overflow body on your Ollama version has a different shape from the one quoted. Report the body; do not guess a new parser.
- Adding the `context` Block kind forces changes in `src/view/run-store.ts`, `src/view/live-lines.ts` or `src/view/ink/*.tsx` beyond what TypeScript requires for the new union member. Report what broke.
- Any step needs a change in an out-of-scope file.

## Maintenance notes

- `RunView` gained a seventh method. Plan 005 (`--replay`) replays logs through `RunView` and should call `contextUsed` for `assistant` entries that carry the `usage` field this plan adds. Older logs have no `usage`; treat a missing field as `null`.
- Plan 007 (context reduction) anchors its token estimate on `reply.usage` from Step 2. Keep `AssistantReply.usage` and the `TokenUsage` field names stable.
- The `context` block shows in the transcript screen too (`RunStore.transcriptLines` renders every stored block); that is intended.
- If another Backend is ever added, it must emit a `usage` chunk or the warning silently disappears. That is acceptable, but state it in that Backend's tests.
