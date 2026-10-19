# Plan 001: Render the Run through a dedicated inline view instead of raw stdout writes

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: this plan was written against commit `e9b89ce`
> **plus an uncommitted rename of every file to kebab-case** (e.g.
> `src/run/runLoop.ts` → `src/run/run-loop.ts`). Run:
> `ls src/run/run-loop.ts src/gate/terminal-confirmer.ts src/cli.ts test/run/run-loop.test.ts`
> All four must exist. If any is missing, STOP (the rename has not landed in
> your checkout). Then compare every "Current state" excerpt below against the
> live file; on any mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW (presentation only; Run behaviour, gate rules and logs are unchanged)
- **Depends on**: none (but the kebab-case rename must be committed first; see drift check)
- **Category**: direction (UI design) + tech-debt
- **Planned at**: commit `e9b89ce` + uncommitted kebab-case rename, 2026-10-19

## Why this matters

The harness is a one-shot CLI (`harness "task"`) that streams a local model's text, prints one line per tool call, and stops for a y/n/a Confirmation before write/edit/shell. Today all terminal output is ad-hoc string writes spread over three files, so the screen has no structure: model text, tool results and the gate run together with no indentation, no spinner while a slow local model is thinking (often 10–60 s of silence), and no end-of-run summary beyond a dim line. The gate preview also mis-colours jsdiff's file headers: `--- a.txt` is printed red and `+++ a.txt` green, as if they were removed/added lines.

After this plan, the Run loop emits typed view events through a `RunView` interface, and one terminal implementation renders an inline, scrollback-friendly layout (header → task → streamed text → tool lines → gate → summary). Presentation becomes unit-testable and leaves `src/run/` free of formatting code.

## Current state

### Files and roles

- `src/cli.ts` — entry point; prints a one-line dim header and footer, wires `out: (text) => process.stdout.write(text)` into `runTask`.
- `src/run/run-loop.ts` — the Harness loop. Takes `RunDeps.out`, passes it to `collectReply`, and formats tool results itself (`formatOutcome`).
- `src/run/collect-reply.ts` — consumes backend chunks, calls `out(chunk.text)` per text chunk, gathers Tool Calls. **Do not change this file.**
- `src/gate/terminal-confirmer.ts` — the Confirmation prompt; prints the colourised preview then a `@clack/prompts` `selectKey`.
- `src/gate/preview.ts` — builds the preview string: `$ <command>` for shell, a jsdiff unified patch (capped at 80 lines) for write/edit. **Do not change this file.**
- `src/tools/tool-call.ts` — `ToolCall` type and `describeToolCall(call)` (e.g. `"read: a.txt"`, `"shell: ls"`).
- `src/tools/execute-tool.ts` — exports `ToolOutcome` (`{ ok: boolean; output: string }`).

### Excerpts

Prettier removed the leading indentation from these code blocks. Compare the code tokens, not the whitespace.

`src/cli.ts:21-35`:

```ts
process.stdout.write(pc.dim(`model ${model} via ${backendUrl}, log ${log.path}\n\n`));
const result = await runTask(
  args.task,
  systemPrompt,
  { ...args.runOptions, target, model },
  {
    backend: new OllamaBackend(backendUrl),
    confirmer: new TerminalConfirmer(),
    log,
    out: (text) => process.stdout.write(text),
  },
);
process.stdout.write(
  pc.dim(`\n\nrun ended: ${result.endReason} after ${result.iterations} tool calls\n`),
);
```

`src/run/run-loop.ts:29-39`:

```ts
export interface RunDeps {
  backend: Backend;
  confirmer: Confirmer;
  log: RunLog;
  out: (text: string) => void;
}

export interface RunResult {
  endReason: string;
  iterations: number;
}
```

`src/run/run-loop.ts:80-83`:

```ts
const reply = await collectReply(deps.backend.chat(request, signal), deps.out);
messages.push({ role: "assistant", content: reply.text, tool_calls: reply.calls });
await deps.log.record({ event: "assistant", text: reply.text, calls: reply.calls });
if (reply.calls.length === 0) return { ...state, endReason: "model gave a final answer" };
```

`src/run/run-loop.ts:99-104` and `135-139`:

```ts
const gated = gateToolCall(state, call);
const { state: afterGate, outcome } = await resolveGate(gated, call, options, deps);
deps.out(formatOutcome(call, outcome));
messages.push({ role: "tool", content: outcome.output, tool_name: call.name });
await deps.log.record({ event: "tool", call, ...outcome });
return afterGate;
```

```ts
function formatOutcome(call: ToolCall, outcome: ToolOutcome): string {
  const marker = outcome.ok ? "✓" : "✗";
  const firstLine = outcome.output.split("\n")[0] ?? "";
  return `\n${marker} ${describeToolCall(call)}${outcome.ok ? "" : ` → ${firstLine}`}\n`;
}
```

`src/gate/terminal-confirmer.ts` (whole file):

```ts
import { isCancel, selectKey } from "@clack/prompts";
import pc from "picocolors";
import type { ConfirmationChoice } from "../run/run-state.js";
import { describeToolCall, type ToolCall } from "../tools/tool-call.js";
import type { Confirmer } from "./confirmer.js";

export class TerminalConfirmer implements Confirmer {
  async confirm(call: ToolCall, preview: string): Promise<ConfirmationChoice> {
    if (!process.stdin.isTTY)
      throw new Error("confirmation needs an interactive terminal; rerun with --yolo");
    process.stdout.write(`\n${colourPreview(preview)}\n`);
    const choice = await selectKey<ConfirmationChoice>({
      message: `Allow ${describeToolCall(call)}?`,
      options: [
        { value: "y", label: "yes" },
        { value: "n", label: "no" },
        { value: "a", label: `allow every ${call.name} for this run` },
      ],
    });
    return isCancel(choice) ? "n" : choice;
  }
}

function colourPreview(preview: string): string {
  return preview
    .split("\n")
    .map((line) =>
      line.startsWith("+") ? pc.green(line) : line.startsWith("-") ? pc.red(line) : pc.dim(line),
    )
    .join("\n");
}
```

A real edit preview, as produced by `buildPreview` for `a.txt` changing `hello` → `bye` (verified with jsdiff 9):

```
Index: a.txt
===================================================================
--- a.txt
+++ a.txt
@@ -1,1 +1,1 @@
-hello
+bye
<trailing empty line>
```

The first four lines are headers. `colourPreview` paints `--- a.txt` red and `+++ a.txt` green. That is the colouring bug.

Tool outputs you will summarise (from `src/tools/*`):

- `read` returns file contents; `glob` / `grep` return newline-separated matches; `shell` returns combined stdout+stderr.
- `write` returns `wrote <path>`; `edit` returns `edited <path>`.
- On failure, `output` is the error text. For shell it starts with `exit <code>`.

### Target layout (from `docs/research/agent-tui-patterns.md`, "Recommendations (a)")

The project's own research settled on an **inline** layout. Inline means it appends to scrollback, uses no alt screen and no full-screen framework, and adds no new dependencies (Ink, OpenTUI and blessed were rejected there). Rules quoted from that doc:

> Inline, not full-screen. One-shot runs do not need an alt screen, and the output stays in scrollback after exit.
> **Streaming:** write tokens to stdout as they arrive. … Stop the spinner on first token.
> **Prompt interleaving:** do not open the gate while a text line is partial. Finish the stream for the step first.
> **Tool output:** one line per tool call by default, with line count …

This plan's exact target screen (colours omitted; `│` gutter lines come from the gate):

```
harness · qwen3:8b via http://localhost:11434
log /repo/.harness/runs/2026-10-19T12-00-00-000Z.jsonl
────────────────────────────────────────────────────────────
> make the failing test pass

  I'll look at the test first.
  ✓ read: test/a.test.ts · 40 lines
  ✗ shell: pnpm test → exit 1
│
│  @@ -1,1 +1,1 @@
│  -hello
│  +bye
◆  Allow edit: a.txt?            <- clack selectKey renders this part
  ✓ edit: a.txt
  Done.
────────────────────────────────────────────────────────────
✓ model gave a final answer · 3 tool calls · 42s
```

### Conventions to match

- TypeScript strict, ESM, `.js` suffix on relative imports (`import { x } from "./y.js"`).
- File names are kebab-case. One small concern per file. Small single-purpose functions.
- **No comments of any kind**, including lint suppressions. A hook rejects them.
- Colour via `picocolors` (`import pc from "picocolors"`), as in `src/cli.ts`.
- Test fakes are small classes in `test/<area>/fake-*.ts`. Exemplar `test/backend/fake-backend.ts`:

```ts
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
```

- Tests use vitest `describe` / `it` / `expect`. Exemplar `test/run/collect-reply.test.ts`.
- Vocabulary (`GLOSSARY.md`): say **Run** (not session), **Tool Call** (not action), **Confirmation** (not approval/permission), **Model**, **Backend**. Use these words in identifiers and UI text.
- **Colour in tests:** picocolors turns colour on when the `CI` env var is set or stdout is a TTY. Never assert on raw coloured strings. Strip ANSI first with Node's built-in `stripVTControlCharacters` from `node:util`. Do not write a regex with `\x1b`, because eslint's `no-control-regex` rejects it.

## Commands you will need

| Purpose   | Command                      | Expected on success                     |
| --------- | ---------------------------- | --------------------------------------- |
| Install   | `pnpm install`               | exit 0                                  |
| Typecheck | `pnpm typecheck`             | exit 0, no output                       |
| Tests     | `pnpm test`                  | all pass (baseline: 13 files, 50 tests) |
| One file  | `pnpm test test/view/<file>` | all pass                                |
| Lint      | `pnpm lint`                  | exit 0 (eslint + prettier --check)      |
| Format    | `pnpm format`                | rewrites files; run before `pnpm lint`  |

Use `pnpm`, never `npm`.

## Suggested executor toolkit

- If available, use the `tdd` skill: every step below writes the failing test first.

## Scope

**In scope** (the only files you may create or modify):

- `src/view/run-view.ts` (create)
- `src/view/stream-indent.ts` (create)
- `src/view/spinner.ts` (create)
- `src/view/tool-line.ts` (create)
- `src/view/run-frame.ts` (create)
- `src/view/preview-render.ts` (create)
- `src/view/terminal-run-view.ts` (create)
- `src/run/run-loop.ts`
- `src/gate/terminal-confirmer.ts`
- `src/cli.ts`
- `test/view/*.test.ts` and `test/view/recording-view.ts` (create)
- `test/run/run-loop.test.ts`
- `test/live/ollama.live.test.ts` (only the `out:` line)
- `plans/README.md` (status row)

**Out of scope** (do NOT touch):

- `src/run/collect-reply.ts` and its test. Its `out: (text) => void` parameter stays as is; the loop adapts to it.
- `src/gate/preview.ts`. The 80-line cap and the patch format stay. Rendering is fixed downstream.
- `src/run/run-state.ts`. The gate rules, the y/n/a meaning and "allow every X for this Run" stay.
- The JSONL run log contents (`deps.log.record(...)` calls). Keep every call unchanged.
- New dependencies. Do not add Ink, ora, chalk, cli-spinners or anything else. `picocolors` and `@clack/prompts` are already installed.
- Ctrl-C/Esc behaviour in the gate, scoped "don't ask again", a press-`v`-to-expand key, Thinking display, token counts. These are deferred (see Maintenance notes).

## Git workflow

- Branch: `advisor/001-inline-run-view`.
- One commit per step is fine. Message style matches the repo: a short imperative sentence, e.g. `Add RunView and route tool results through it`. Add a `Co-Authored-By:` trailer only if your operator tells you to.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the `RunView` interface and a recording fake

Create `src/view/run-view.ts`:

```ts
import type { ToolOutcome } from "../tools/execute-tool.js";
import type { ToolCall } from "../tools/tool-call.js";

export interface RunView {
  replyStarted(): void;
  replyText(text: string): void;
  replyEnded(): void;
  toolFinished(call: ToolCall, outcome: ToolOutcome): void;
}
```

Create `test/view/recording-view.ts`, a `RecordingView implements RunView`. It has a `readonly events: string[]` that each method appends to, in this format: `"reply-started"`, `"text:<text>"`, `"reply-ended"`, `"tool:<call.name>:<ok|fail>"`. Add a getter `text` that returns all `text:` payloads joined with `""`.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Route the Run loop through `RunView`

In `src/run/run-loop.ts`:

1. Replace `out: (text: string) => void;` in `RunDeps` with `view: RunView;` and import the type from `../view/run-view.js`.
2. Add and export `export const FINAL_ANSWER_REASON = "model gave a final answer";`. Use it in place of the string literal in `oneTurn`.
3. In `oneTurn`, replace the `collectReply` line with:

```ts
deps.view.replyStarted();
const reply = await collectReply(deps.backend.chat(request, signal), (text) => {
  deps.view.replyText(text);
});
deps.view.replyEnded();
```

If `collectReply` throws (a backend error), the `catch` in `runTask` handles it. Do not add a `finally`. `cli.ts` prints the summary after the Run, and step 7 makes the terminal view tolerate a missing `replyEnded`.

Then, still in `src/run/run-loop.ts`:

- In `handleToolCall`, replace `deps.out(formatOutcome(call, outcome));` with `deps.view.toolFinished(call, outcome);`.
- Delete `formatOutcome`. Remove the `describeToolCall` import if it becomes unused.

Update tests:

- `test/run/run-loop.test.ts`: replace every `out: ...` with `view: new RecordingView()` (import from `../view/recording-view.js`). In the first test, keep a reference (`const view = new RecordingView();`). Replace `expect(output.join("")).toContain("Done.")` with `expect(view.text).toContain("Done.")`. Also assert `expect(view.events).toContain("tool:edit:ok")`. Delete the now-unused `output` array.
- Add one test to `test/run/run-loop.test.ts`: "brackets each reply with replyStarted and replyEnded". Script `FakeBackend([[text("Hi")]])` and expect `view.events` to equal `["reply-started", "text:Hi", "reply-ended"]`.
- `test/live/ollama.live.test.ts`: replace `out: () => undefined,` with `view: { replyStarted: () => undefined, replyText: () => undefined, replyEnded: () => undefined, toolFinished: () => undefined },`. Do not import the test helper from a live test.

`src/cli.ts` will not compile yet. That is expected until step 8. To keep the tree green, temporarily pass a minimal inline view in `cli.ts` that writes text with `process.stdout.write` and prints nothing for the other events. Step 8 replaces it.

**Verify**: `pnpm typecheck` → exit 0. `pnpm test` → all pass (51 tests).

### Step 3: Stream indentation

Create `src/view/stream-indent.ts` exporting:

```ts
export interface IndentedChunk {
  text: string;
  atLineStart: boolean;
}

export function indentStream(text: string, atLineStart: boolean): IndentedChunk;
```

Rule: prefix two spaces (`const INDENT = "  "`) to every non-empty line segment that starts a line. A segment starts a line if it follows a `\n` in this chunk, or if it is the first segment and `atLineStart` is true. The returned `atLineStart` is true when the chunk ends with `\n`. For an empty `text` it is the `atLineStart` argument, unchanged.

Write `test/view/stream-indent.test.ts` first, with these cases:

| text       | atLineStart in | expected text | atLineStart out |
| ---------- | -------------- | ------------- | --------------- |
| `"Hi"`     | true           | `"  Hi"`      | false           |
| `" there"` | false          | `" there"`    | false           |
| `"a\nb"`   | false          | `"a\n  b"`    | false           |
| `"a\n"`    | true           | `"  a\n"`     | true            |
| `"\n\nx"`  | true           | `"\n\n  x"`   | false           |
| `""`       | true           | `""`          | true            |

**Verify**: `pnpm test test/view/stream-indent.test.ts` → 6 pass.

### Step 4: Spinner

Create `src/view/spinner.ts` exporting `startSpinner(write: (text: string) => void): () => void`.

- Frames: `const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]`. Interval `80` ms. Label `waiting for model`.
- On start, write `\r<frame> waiting for model` dimmed (`pc.dim`) immediately. Then write the next frame on each tick, cycling through the frames.
- The returned `stop` clears the interval and writes `"\r\u001b[2K"` (const `CLEAR_LINE`). Make it idempotent: a second call writes nothing.

Write `test/view/spinner.test.ts` first using `vi.useFakeTimers()` / `vi.advanceTimersByTime` / `vi.useRealTimers()` in `afterEach`. Cases:

1. Writes one frame immediately, then one more per 80 ms. After advancing 160 ms, 3 writes. Each one, ANSI-stripped, starts with `\r` and ends with `waiting for model`.
2. `stop()` writes `"\r\u001b[2K"`, and no writes happen after it even when timers advance.
3. Calling `stop()` twice writes the clear sequence only once.

Strip with `stripVTControlCharacters` from `node:util`. Note that it also strips `\u001b[2K`. For case 2, compare the raw last write to `"\r\u001b[2K"` without stripping.

**Verify**: `pnpm test test/view/spinner.test.ts` → 3 pass.

### Step 5: Tool line

Create `src/view/tool-line.ts` exporting `formatToolLine(call: ToolCall, outcome: ToolOutcome): string`. It returns one line with no trailing newline:

- Success: `  ✓ <describeToolCall(call)>` plus a detail. For `write` and `edit` there is no detail. For other tools the detail is ` · <n> lines` (`1 line` when n is 1, `0 lines` when the output is empty). Count n by splitting on `\n` after removing one trailing `\n`; empty output counts as 0.
- Failure: `  ✗ <describeToolCall(call)> → <first line of output>`.
- Colours: `✓` green, `✗` red, the detail (`· n lines` / `→ …`) dim. Leave the description uncoloured.

Write `test/view/tool-line.test.ts` first. Assert on ANSI-stripped output:

1. read, ok, `"a\nb\n"` → `"  ✓ read: a.txt · 2 lines"`
2. grep, ok, `"x.ts:1:foo"` → `"  ✓ grep: foo · 1 line"`
3. glob, ok, `""` → `"  ✓ glob: *.md · 0 lines"` (glob arguments: `{ pattern: "*.md" }`)
4. edit, ok, `"edited a.txt"` → `"  ✓ edit: a.txt"`
5. shell, fail, `"exit 1\nboom"` → `"  ✗ shell: pnpm test → exit 1"`

**Verify**: `pnpm test test/view/tool-line.test.ts` → 5 pass.

### Step 6: Run header and summary

Create `src/view/run-frame.ts` exporting:

```ts
export interface RunHeader {
  model: string;
  backendUrl: string;
  logPath: string;
  task: string;
}

export function formatRunHeader(header: RunHeader, width: number): string;
export function formatRunSummary(result: RunResult, elapsedMs: number, width: number): string;
export function ruleWidth(columns: number | undefined): number;
```

- `ruleWidth`: `Math.min(columns ?? 60, 60)`.
- Rule: `"─".repeat(width)`, dim.
- `formatRunHeader` returns exactly these lines, joined with `\n` and ending in `\n\n`:
  1. `harness · <model> via <backendUrl>`, with `harness` bold and the rest dim
  2. `log <logPath>`, dim
  3. the rule
  4. `> <task>`, with `>` cyan
- `formatRunSummary` returns `\n<rule>\n<marker> <endReason> · <n> tool call(s) · <duration>\n`.
  - marker: green `✓` when `result.endReason === FINAL_ANSWER_REASON` (import from `../run/run-loop.js`), otherwise yellow `!`.
  - `tool call` is singular when `iterations === 1`.
  - duration: under 60 s → `<s>s` (rounded to whole seconds); otherwise `<m>m <ss>s` with seconds zero-padded to 2 digits.

Write `test/view/run-frame.test.ts` first. Assert on ANSI-stripped output:

1. Header with width 10 equals `"harness · m via http://h\nlog /l.jsonl\n──────────\n> do it\n\n"`.
2. Summary `{ endReason: "model gave a final answer", iterations: 1 }`, 4_400 ms, width 3 → `"\n───\n✓ model gave a final answer · 1 tool call · 4s\n"`.
3. Summary `{ endReason: "iteration cap reached", iterations: 50 }`, 125_000 ms, width 3 → `"\n───\n! iteration cap reached · 50 tool calls · 2m 05s\n"`.
4. `ruleWidth(undefined)` → 60, `ruleWidth(200)` → 60, `ruleWidth(40)` → 40.

**Verify**: `pnpm test test/view/run-frame.test.ts` → 4 pass.

### Step 7: Terminal run view

Create `src/view/terminal-run-view.ts`:

```ts
export class TerminalRunView implements RunView {
  constructor(
    private readonly write: (text: string) => void,
    private readonly interactive: boolean,
  ) {}
}
```

Behaviour. Keep private state `atLineStart = true` and `stopSpinner: (() => void) | null = null`.

- `replyStarted()`: if `interactive`, set `stopSpinner = startSpinner(this.write)`.
- `replyText(text)`: stop the spinner (call it if set, then set it to null). Then `const chunk = indentStream(text, this.atLineStart)`, write `chunk.text` if it is non-empty, and store `chunk.atLineStart`.
- `replyEnded()`: stop the spinner. If not `atLineStart`, write `"\n"` and set `atLineStart = true`.
- `toolFinished(call, outcome)`: call `replyEnded()` first, as a guard. Then write `formatToolLine(call, outcome) + "\n"`.

Write `test/view/terminal-run-view.test.ts` first, with `interactive: false` and a `writes: string[]` sink. Assert on `stripVTControlCharacters(writes.join(""))`:

1. `replyStarted(); replyText("Hi "); replyText("there"); replyEnded();` → `"  Hi there\n"`.
2. Same sequence, then `toolFinished(read a.txt, ok "x\n")` → `"  Hi there\n  ✓ read: a.txt · 1 line\n"`.
3. `toolFinished` with no prior `replyEnded` after `replyText("partial")` → `"  partial\n  ✓ …"`. No line is left glued.
4. `interactive: false`: `replyStarted()` writes nothing.

Add one case with `interactive: true` and fake timers. `replyStarted()` writes a spinner frame, then `replyText("x")` writes `"\r\u001b[2K"` before `"  x"`.

**Verify**: `pnpm test test/view/terminal-run-view.test.ts` → 5 pass.

### Step 8: Wire the view into `cli.ts`

Replace the temporary inline view from step 2. Target shape of the relevant part of `main()`:

```ts
const width = ruleWidth(process.stdout.columns);
const write = (text: string): void => {
  process.stdout.write(text);
};
write(formatRunHeader({ model, backendUrl, logPath: log.path, task: args.task }, width));
const startedAt = Date.now();
const result = await runTask(
  args.task,
  systemPrompt,
  { ...args.runOptions, target, model },
  {
    backend: new OllamaBackend(backendUrl),
    confirmer: new TerminalConfirmer(),
    log,
    view: new TerminalRunView(write, process.stdout.isTTY),
  },
);
write(formatRunSummary(result, Date.now() - startedAt, width));
```

`process.stdout.isTTY` is typed `boolean` but is `undefined` when piped. Pass `process.stdout.isTTY === true` if typecheck or lint complains. Leave the `main().catch(...)` error line as it is.

**Verify**: `pnpm typecheck` → exit 0. `pnpm test` → all pass.

### Step 9: Fix and frame the gate preview

Create `src/view/preview-render.ts` exporting `renderPreview(preview: string): string`:

1. Split into lines. If any line starts with `@@`, drop every line before the first `@@` line. That removes `Index:`, `====`, `--- path` and `+++ path`. Only drop lines before the first hunk, because a removed line inside a hunk can legitimately start with `---`.
2. Drop one trailing empty line, if present.
3. Colour each line:
   - `@@` → cyan
   - `+` → green
   - `-` → red
   - `$ ` → bold (shell command)
   - `... ` → dim (the "N more lines" cap)
   - anything else → dim
4. Prefix each line with `pc.gray("│") + "  "`, which matches clack's prompt gutter. Join with `\n`.

Write `test/view/preview-render.test.ts` first. Assert on ANSI-stripped output:

1. Input `"Index: a.txt\n====\n--- a.txt\n+++ a.txt\n@@ -1,1 +1,1 @@\n-hello\n+bye\n"` → `"│  @@ -1,1 +1,1 @@\n│  -hello\n│  +bye"`.
2. `"$ ls -la"` → `"│  $ ls -la"`.
3. `"edit cannot be applied: see tool result"` → `"│  edit cannot be applied: see tool result"`.
4. A hunk containing the removed line `--- old sql comment` keeps it: input `"@@ -1 +1 @@\n--- old\n+new\n"` → `"│  @@ -1 +1 @@\n│  --- old\n│  +new"`.
5. Integration: build a preview with `buildPreview` (pattern from `test/gate/preview.test.ts`: temp dir, `a.txt` with `"one\ntwo\n"`, edit `two` → `three`). Assert `renderPreview(preview)`, stripped, does not contain `Index:` and does not contain `+++`.

Then in `src/gate/terminal-confirmer.ts`, replace the write line with:

```ts
process.stdout.write(`${pc.gray("│")}\n${renderPreview(preview)}\n`);
```

Delete `colourPreview`. Remove the `picocolors` import only if nothing else uses it.

**Verify**: `pnpm test test/view/preview-render.test.ts` → 5 pass. `grep -n "colourPreview" -r src` → no matches.

### Step 10: Full gates

Run `pnpm format`, then:

**Verify**:

- `pnpm typecheck` → exit 0
- `pnpm lint` → exit 0
- `pnpm test` → all pass. That is 51 tests from step 2 + 6 + 3 + 5 + 4 + 5 + 5 = 79, give or take if you split cases differently. None fail.
- `grep -rn "formatOutcome\|colourPreview\|deps.out\|out:" src test` → no matches
- `grep -rn "//\|/\*" src/view test/view` → no matches (no comments)

### Step 11: Live check (manual, only if a Backend is available)

Only do this if `curl -s http://localhost:11434/api/tags` succeeds. Otherwise skip it and write "live check skipped: no Ollama" in your report.

1. Create a scratch repo: `cd "$(mktemp -d)" && git init -q && echo hello > a.txt && git add . && git commit -qm init`.
2. Run `<path-to-harness>/bin/harness.js "change hello to bye in a.txt"` in a real terminal. If the operator runs cmux, use a cmux pane.
3. Confirm by eye:
   - the header and rule appear
   - the spinner shows and then disappears on the first token
   - model text is indented two spaces
   - the gate shows a `│` gutter with no `Index:` or `+++` lines
   - each tool line starts with `  ✓` or `  ✗`
   - the summary line ends with `· <n>s`
4. Pipe check: `<path>/bin/harness.js --yolo "say hi" | cat`. There should be no spinner frames or `\r` junk in the output.

Report what you saw. Do not change code based on aesthetics beyond this plan. List suggestions in your report instead.

## Test plan

New test files, all under `test/view/`, modelled on `test/run/collect-reply.test.ts`:

- `stream-indent.test.ts` (6 cases)
- `spinner.test.ts` (3, fake timers)
- `tool-line.test.ts` (5)
- `run-frame.test.ts` (4)
- `terminal-run-view.test.ts` (5)
- `preview-render.test.ts` (5, including the header-colouring regression in case 1 and the `---`-inside-hunk edge case in case 4)

Changed: `test/run/run-loop.test.ts` uses `RecordingView` and gains one event-order test.

Every presentation assertion strips ANSI with `stripVTControlCharacters`, so tests pass with and without `CI` set. Run `CI=1 pnpm test` once to prove it.

## Done criteria

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm lint` exits 0
- [ ] `pnpm test` exits 0, and `CI=1 pnpm test` exits 0
- [ ] The six new `test/view/*.test.ts` files exist and pass
- [ ] `grep -rn "formatOutcome\|colourPreview\|deps\.out" src` → no matches
- [ ] `grep -rn "picocolors\|\"✓\"\|\"✗\"" src/run` → no matches (no presentation left in the loop)
- [ ] `git diff --name-only` (plus untracked files) lists only in-scope files
- [ ] `git diff src/run/collect-reply.ts src/gate/preview.ts src/run/run-state.ts` is empty
- [ ] `plans/README.md` row for 001 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The drift check fails: camelCase file names, or excerpts that differ from the live code.
- `@clack/prompts` `selectKey` visibly breaks the `│` gutter alignment in the live check, for example by wiping the preview lines above it. Report a screenshot or a description. Do not switch prompt libraries.
- Making a test pass seems to need a change to `collect-reply.ts`, `preview.ts` or `run-state.ts`.
- The spinner leaves stray characters when a Tool Call reply has no text at all (`replyStarted` → `replyEnded` only), and the cause is not obvious within two attempts.
- You feel the need to add a dependency.

## Maintenance notes

- **Seam:** `RunView` is now the only way the loop talks to the screen. Future UI work goes behind it: a `--json` event stream, a press-`v` expand key, or an Ink/pi-tui renderer if live regions are ever needed (the research doc's threshold). The loop should not change for any of those.
- **Spinner versus Confirmation:** the spinner only runs between `replyStarted` and the first text or `replyEnded`. The gate always opens after `replyEnded`, so they never overlap. Keep that ordering if replies ever start streaming Tool Calls mid-text.
- **Deferred on purpose** (each changes behaviour, not only presentation, so each needs its own plan):
  - Ctrl-C/Esc at the gate currently maps to "n" and the Run continues. The research doc recommends "deny and stop the Run".
  - Scoped "allow for this Run". It allows the whole tool today; the research doc suggests a command prefix for shell.
  - Showing Qwen Thinking. `src/backend/ollama-chunks.ts` ignores Ollama's `message.thinking` field, so `--think` output is invisible.
  - Dimming leaked `</think>` text. This is not possible in an append-only stream without buffering, because the close tag arrives last.
  - A token count in the summary. This needs `eval_count` parsed in `ollama-chunks.ts`.
- **Review focus:**
  - `\r` and clear-line writes must never happen when stdout is not a TTY.
  - Every `deps.log.record` call must be byte-for-byte unchanged.
  - No colour assertions may be made on raw strings.
