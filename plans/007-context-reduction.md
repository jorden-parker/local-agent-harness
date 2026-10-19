# Plan 007: Keep the conversation inside `--num-ctx` by eliding old tool output and adding ranged reads

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Prerequisite (run first)**: plan 002 must be DONE.
> `grep -n '"usage"' src/backend/backend.ts && grep -n "usage" src/run/collect-reply.ts`
> must both match. If either does not, STOP.
>
> **Drift check**: `git log --oneline -n 20 d56080c..HEAD -- src/run src/tools`
> should list only the commits of plan 002 and plan 008. Plan 008 (path
> confinement) edits `readTool` in `src/tools/file-tools.ts` and
> `src/run/run-loop.ts`, and is meant to land before this plan. If 008 or any
> other commit touched these paths, compare every excerpt below with the live
> file. Plan 008 changing how `readTool` resolves its path is expected: keep
> its resolution and add the range on top. Any other mismatch: STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (changes what the Model sees; an over-eager elision makes the Model re-read files, and a buggy one could hide the latest result)
- **Depends on**: plans/002-context-window-usage.md
- **Category**: direction
- **Planned at**: commit `d56080c`, 2026-10-19
- **Refreshed**: 2026-10-19 by `/improve reconcile` (was `9d2cb42`). The finding still holds; excerpts were re-read and line numbers updated after the Ink RunView port. Exported constants were cut to fit the repo's dead-export rule.

## Why this matters

The harness runs small local Models with a 32K-token window (`--num-ctx`, default 32768). Every Tool Call result is appended to the conversation and kept for the rest of the Run. Today the only limits are on single outputs: 2000 lines or 50 KB per tool result, 500 grep matches, and a 200-entry file tree in the system prompt. Nothing shrinks the conversation once it grows, and `read` always returns the whole file.

Ollama 0.33 does not truncate an oversized prompt. It rejects the request (HTTP 400, `exceed_context_size_error`), so a long Run simply dies. Plan 002 made that visible; this plan prevents it in the common case.

The approach is **observation masking**: when the conversation nears the window, the oldest tool results are replaced with a one-line stub, and the Model can call the tool again if it still needs one. Masking is deterministic, needs no extra Model call, and keeps the Model's own reasoning (assistant messages) intact. A ranged `read` stops one large file from filling the window on its own.

## Current state

### Measured facts (Ollama 0.33.2, `qwen3:4b-instruct-2507-q4_K_M`, 2026-10-19)

| Content                    | chars per token |
| -------------------------- | --------------- |
| TypeScript (`run-loop.ts`) | 3.95            |
| Markdown prose             | 3.89            |
| `pnpm-lock.yaml`           | 1.91            |

So any character-based estimate must assume **2 chars per token** to be safe. That over-counts code by about 2×. This plan therefore estimates only the **new** messages by characters and anchors everything else on the real `prompt_eval_count` that plan 002 provides.

### What plan 002 provides (its contract; verify against the live files)

- `src/backend/backend.ts` exports a `TokenUsage` type with `promptTokens` and `outputTokens` (numbers), and `ChatChunk` has a `usage` variant that carries one.
- `collectReply` in `src/run/collect-reply.ts` returns a reply that has `usage: TokenUsage | null` next to `text` and `calls`.
- `oneTurn` in `src/run/run-loop.ts` passes the usage to the view and logs it on the `assistant` entry.

Plan 002 may also have added lines to `oneTurn`. Those lines are expected, and the lines this plan adds go around them.

### Excerpts at `d56080c`, before plans 002 and 008

`src/run/run-loop.ts:50-58` (in `runTask`): the conversation is one mutable array.

```ts
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: task },
  ];
  const signal = AbortSignal.timeout(options.timeoutMs);
  let state = initialRunState(options.limits, options.flags);
  await deps.log.record({ event: "start", task, model: options.model, options });
  try {
    while (state.endReason === null) state = await oneTurn(messages, state, options, deps, signal);
```

`src/run/run-loop.ts:76-88` (in `oneTurn`): this builds the request and pushes the assistant message.

```ts
const request = {
  model: options.model,
  messages,
  tools: TOOL_DEFINITIONS,
  think: options.think,
  numCtx: options.numCtx,
};
deps.view.replyStarted();
const reply = await collectReply(deps.backend.chat(request, signal), deps.view);
deps.view.replyEnded();
messages.push({ role: "assistant", content: reply.text, tool_calls: reply.calls });
await deps.log.record({ event: "assistant", text: reply.text, calls: reply.calls });
if (reply.calls.length === 0) return { ...state, endReason: FINAL_ANSWER_REASON };
```

`src/run/run-loop.ts:107` (in `handleToolCall`): this is the only place tool results enter the conversation.

```ts
messages.push({ role: "tool", content: outcome.output, tool_name: call.name });
```

`src/backend/backend.ts:3-6`:

```ts
export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: ToolCall[] }
  | { role: "tool"; content: string; tool_name: string };
```

`src/tools/file-tools.ts:6-9`:

```ts
export async function readTool(target: string, call: ToolCall): Promise<string> {
  const path = await resolveInsideTarget(target, stringArgument(call, "path"));
  return readTextFile(path, stringArgument(call, "path"));
}
```

`src/tools/file-tools.ts:40-46`:

```ts
async function readTextFile(path: string, relative: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    throw new ToolError(`cannot read ${relative}: file not found`);
  }
}
```

`src/tools/tool-definitions.ts:21` (the read entry):

```ts
  definition("read", "Read a text file and return its full contents.", { path }, ["path"]),
```

`src/tools/tool-call.ts:15-19`:

```ts
export function stringArgument(call: ToolCall, key: string): string {
  const value = call.arguments[key];
  if (typeof value !== "string") throw new Error(`${call.name} needs a string "${key}" argument`);
  return value;
}
```

### Conventions to match

- Rules are small pure functions with direct unit tests (see `src/run/run-state.ts` and `test/run/run-state.test.ts`). Tool tests use a `mkdtemp` target (see `test/tools/execute-tool.test.ts`, with its `call(name, args)` helper).
- Named constants go at the top of the module and are **not exported** unless another module imports them (`const MAX_LINES = 2000;` in `src/tools/tool-output.ts`). Fallow fails the Stop hook on unused exports. Commit `ffc5a1d` removed several of them, including `TOOL_NAMES` in `tool-call.ts`.
- `test/backend/fake-backend.ts` stores a `structuredClone` of each request in `backend.requests`. An earlier request therefore keeps the content it had when it was sent, even after `reduce` mutates `messages`.
- **No code comments of any kind**, including lint suppressions. A hook rejects them.
- Strict TS (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- Glossary (`GLOSSARY.md`): **Run**, **Model**, **Tool Call**. Avoid "session" and "LLM".

## Commands you will need

| Purpose   | Command                                      | Expected on success          |
| --------- | -------------------------------------------- | ---------------------------- |
| Typecheck | `pnpm typecheck`                             | exit 0                       |
| Tests     | `pnpm vitest run test/run test/tools`        | all pass                     |
| All gates | `.claude/verify`                             | exit 0                       |
| Dead code | `npx fallow --format json`                   | no findings in changed files |
| Live      | `pnpm test:live` (needs Ollama on localhost) | pass                         |

## Scope

**In scope**:

- `src/run/context-budget.ts` (create), `test/run/context-budget.test.ts` (create)
- `src/run/run-loop.ts`, `test/run/run-loop.test.ts`
- `src/tools/file-tools.ts`, `src/tools/tool-call.ts`, `src/tools/tool-definitions.ts`
- `test/tools/execute-tool.test.ts`
- `README.md` (one bullet)

**Out of scope**:

- Summarising old turns with a Model call (LLM compaction). It costs a full extra inference on a slow local Model, and small Models summarise poorly. Revisit only if masking proves insufficient.
- Changing or deleting system, user or assistant messages. Only `role: "tool"` messages are elided.
- `src/tools/tool-output.ts` caps and `src/prompt/system-prompt.ts`. Scaling them to `--num-ctx` is a possible follow-up.
- `RunView` / terminal output. Elision is recorded in the log only.

## Git workflow

- Branch: `advisor/007-context-reduction`.
- Conventional commits, e.g. `feat: add ranged read`, then `feat: elide old tool output near the context limit`.
- Do not push or open a PR unless the operator told you to.

## Steps

### Step 1: Ranged `read` (test first)

In `src/tools/tool-call.ts` add `optionalPositiveInteger(call, key): number | null`:

- `undefined` → `null`;
- a positive integer, or a string of digits that parses to one (small Models often send `"20"`) → that number;
- anything else → throw `Error(`${call.name} needs a positive integer "${key}" argument`)`.

In `src/tools/file-tools.ts`, `readTool` takes optional `offset` (1-based first line, default 1) and `limit` (line count, default all). With neither set, the output is exactly as today. With either set, return only those lines, joined with `"\n"`. When the range ends before the file does, append `\n[lines ${first}-${last} of ${total}; read with offset ${last + 1} for more]`. When `offset` is past the end, throw `ToolError(`offset ${offset} is past the end of ${relative} (${total} lines)`)`.

In `src/tools/tool-definitions.ts` change the read description to `"Read a text file. Use offset and limit to read part of a large file."` and add the properties `offset: { type: "integer", description: "First line to read, starting at 1" }` and `limit: { type: "integer", description: "Number of lines to read" }`. Keep `required: ["path"]`.

Tests in `test/tools/execute-tool.test.ts`, using a 10-line file:

- no range → whole file (the existing test covers this);
- `offset: 3, limit: 2` → lines 3–4 plus the `[lines 3-4 of 10; read with offset 5 for more]` hint;
- `offset: "9"` as a string → lines 9–10 with no hint;
- `offset: 20` → `ok: false` with `past the end`;
- `limit: 0` → `ok: false` with `positive integer`.

**Verify**: `pnpm vitest run test/tools` → all pass.

### Step 2: `ContextBudget` (test first)

Create `src/run/context-budget.ts`:

```ts
const ELIDE_AT_RATIO = 0.7;
const ELIDE_DOWN_TO_RATIO = 0.5;
const CHARS_PER_TOKEN_SAFE = 2;
const KEEP_RECENT_TOOL_RESULTS = 2;
const ELIDED_PREFIX = "[elided to save context:";

export class ContextBudget {
  constructor(numCtx: number);
  recordReply(usage: TokenUsage, messageCount: number): void;
  estimate(messages: ChatMessage[]): number;
  reduce(messages: ChatMessage[]): { elided: number; estimateBefore: number };
}
```

Behaviour:

- **Anchor.** `recordReply` stores `anchorTokens = usage.promptTokens + usage.outputTokens` and `anchorCount = messageCount`, i.e. the length of `messages` right after the assistant message was pushed.
- **`estimate`.** With no anchor yet, it is `ceil(total content chars / CHARS_PER_TOKEN_SAFE)` over all messages. With an anchor, it is `anchorTokens + ceil(chars of messages[anchorCount..] / CHARS_PER_TOKEN_SAFE)`.
- **`reduce`.**
  - If `estimate <= numCtx * ELIDE_AT_RATIO`, return `{ elided: 0, estimateBefore }` and change nothing.
  - Otherwise, walk `role: "tool"` messages from oldest to newest, skipping the newest `KEEP_RECENT_TOOL_RESULTS` tool messages and any whose content already starts with `ELIDED_PREFIX`. Replace each one's `content` (mutate in place; `messages` is the Run's array) with `` `${ELIDED_PREFIX} earlier ${tool_name} output, ${lineCount} lines. Call the tool again if you still need it.]` ``.
  - After each replacement, subtract `ceil((oldLength - newLength) / CHARS_PER_TOKEN_SAFE)` from the running estimate **and** from `anchorTokens`, so the next `estimate` stays consistent. Stop as soon as the estimate is at or below `numCtx * ELIDE_DOWN_TO_RATIO`.
  - The gap between 0.7 and 0.5 means elision happens in batches rather than every turn. Each elision invalidates Ollama's prompt cache from that point on, so batching keeps that cost rare.
- Keep each method under ~15 lines. Extract `elideOne(message)` and `charsOf(messages)` as module-private helpers.
- Export only `ContextBudget`. Tests use the literal string `"[elided to save context:"`; they do not import the constant.

Tests in `test/run/context-budget.test.ts` (use `numCtx: 1000`):

1. Below 70% → `elided: 0` and messages unchanged (`toEqual` a `structuredClone` taken before).
2. No anchor and five tool messages of 400 chars each (200 estimated tokens each) plus the system and user messages → elides the oldest ones until the estimate is ≤ 500. The newest two tool messages, plus every system, user and assistant message, are untouched.
3. Already-elided messages are skipped, and running `reduce` twice in a row elides nothing the second time.
4. With an anchor: `recordReply({ promptTokens: 600, outputTokens: 50 }, messages.length)`, then push one tool message of 200 chars → `estimate` is `650 + 100 = 750`.
5. When every elidable message is gone and the estimate is still above the target, `reduce` returns without throwing and the newest two tool results are intact.

**Verify**: `pnpm vitest run test/run/context-budget.test.ts` → all pass.

### Step 3: Use it in the loop

In `src/run/run-loop.ts`:

- In `runTask` (line 44 at `d56080c`), create `const budget = new ContextBudget(options.numCtx);` and pass it to `oneTurn` as a new parameter. Today's loop line is `while (state.endReason === null) state = await oneTurn(messages, state, options, deps, signal);`.
- At the top of `oneTurn`, before `const request = {`, add `const reduced = budget.reduce(messages);`. If `reduced.elided > 0`, add `await deps.log.record({ event: "elided", count: reduced.elided, estimateBefore: reduced.estimateBefore });`.
- Directly after `messages.push({ role: "assistant", ... })`, add `if (reply.usage !== null) budget.recordReply(reply.usage, messages.length);`.
- `oneTurn` will then have six parameters. If ESLint's `max-params` or Fallow's complexity check objects, move the logging into a small helper, `reduceContext(budget, messages, deps)`. Do not add any suppression.

Add a test in `test/run/run-loop.test.ts`. The `options()` helper at line 28 sets `numCtx: 1024`. That is close enough to the 1000 used below, so either use it unchanged or override it to 1000 in the test. Use the `FakeBackend`, `toolCall` and `text` helpers already in the file (see the first test at line 55). Script four turns of `read` on a file with 800 characters of content, and a final `text("done")`. Assert that:

- the last request in `backend.requests` contains at least one tool message whose content starts with `[elided to save context:`;
- the newest tool message in that request is intact;
- `entries` contains an `event: "elided"` entry.

The FakeBackend sends no `usage` chunks, so this exercises the no-anchor path.

**Verify**: `pnpm vitest run test/run` → all pass.

### Step 4: Document, gates, live check

Add a README bullet under "Known small-model quirks": `- Near 70% of --num-ctx the harness replaces the oldest tool results (all but the newest two) with a one-line stub; the Model can call the tool again. The log records an "elided" event.`

**Verify**: `.claude/verify` → exit 0. `npx fallow --format json` → no findings in changed files.

Then run a live Run with a small window in a terminal pane:

```sh
d=$(mktemp -d) && cd "$d" && git init -q && for i in 1 2 3 4 5 6; do seq 1 600 > f$i.txt; done && git add . && git commit -qm init
/Users/jorden/src/local-agent-harness/bin/harness.js --yolo --num-ctx 8192 --model qwen3:4b-instruct-2507-q4_K_M "read f1.txt through f6.txt one at a time, then tell me the sum of their last lines"
grep -c '"event":"elided"' .harness/runs/*.jsonl
```

**Expected**: the Run does not end with `context window full`, and the grep prints 1 or more. Report the final answer and the end reason. A wrong sum is acceptable; this checks context, not arithmetic.

## Test plan

- `test/tools/execute-tool.test.ts`: 4 new read-range cases.
- `test/run/context-budget.test.ts`: 5 tests.
- `test/run/run-loop.test.ts`: 1 integration test.
- `pnpm test` → all pass.

## Done criteria

- [ ] `.claude/verify` exits 0
- [ ] `grep -n "ELIDED_PREFIX" src/run/context-budget.ts` matches
- [ ] `grep -n "budget.reduce\|budget.recordReply" src/run/run-loop.ts` matches both
- [ ] `grep -n "offset" src/tools/tool-definitions.ts src/tools/file-tools.ts` matches in both
- [ ] `grep -n "^export" src/run/context-budget.ts` prints exactly one line (`export class ContextBudget`)
- [ ] `npx fallow --format json` reports 0 issues
- [ ] `git diff --stat d56080c -- src/tools/tool-output.ts src/prompt src/view` shows no changes from this plan
- [ ] `git status` shows only in-scope files changed
- [ ] `plans/README.md` row 007 updated

## STOP conditions

- Plan 002 is not DONE, or its `TokenUsage` / `reply.usage` shapes differ from the "What plan 002 provides" section.
- Plan 008 has landed, and `readTool` no longer reads the file through `readTextFile(path, relative)`, so there is no single place to slice lines.
- Ollama rejects a request whose messages were edited in place (any new 400 error other than `exceed_context_size_error`).
- In the live check the Model loops by re-reading the same elided file more than three times. Report the log; do not tune the ratios yourself.
- Any step needs a change to an out-of-scope file.

## Maintenance notes

- The ratios (0.7 / 0.5) and `KEEP_RECENT_TOOL_RESULTS = 2` are first guesses. Tune them with plan 006's eval suite and the `elided` and `usage` log entries, not by feel.
- The newest two tool results are never elided, so one huge result can still overflow the window. The fix for that is scaling `tool-output.ts` caps to `--num-ctx` (deferred above).
- If plan 005 (`--replay`) is DONE, its log parser skips the unknown `elided` event by design. Adding a replay line for it is optional.
- A reviewer should check that `reduce` never touches the two newest tool messages, and never touches a non-tool message.
- Elision is not shown in the Ink RunView (`src/view/`). If users ask why the Model re-reads a file, a `RunView` event for elision is the natural follow-up. It belongs in `run-store.ts` / `block-lines.ts`.
- Plan 008 and this plan both edit `readTool`. Whichever lands second must keep the other's behaviour: real-path confinement from 008, and the line range from this plan.
