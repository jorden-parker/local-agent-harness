# Plan 005: Replay a Run's JSONL log through the terminal view (`harness --replay`)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat d56080c..HEAD -- src/cli.ts src/cli-args.ts src/log src/run/run-loop.ts src/view/run-view.ts src/view/ink-run-view.tsx test/cli-args.test.ts test/view/recording-view.ts`
> If any of these changed since this plan was written, compare every
> "Current state" excerpt below against the live file. If plan 002 has
> landed, `run-view.ts` has a `contextUsed` method and `run-loop.ts` logs a
> `usage` field; that is expected (see Step 4). On any other mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: S–M
- **Risk**: LOW (new read-only command; the Run path is untouched)
- **Depends on**: none (soft: Step 4 has an extra part if plan 002 is DONE)
- **Category**: direction
- **Planned at**: commit `d56080c`, 2026-10-19
- **Refreshed**: 2026-10-19 by `/improve reconcile` — retargeted from the deleted `TerminalRunView`/`run-frame.ts` to the Ink `InkRunView` (`start`/`finish` now own the header and summary); `parseRunLogLine` contract kept, `start` entries gain `think`.

## Why this matters

`GLOSSARY.md` describes the project as "observable enough to learn from", and every Run writes a JSONL log to `.harness/runs/` in the Target Directory. Nothing reads those logs. Studying a past Run means reading raw JSON by hand.

After this plan, `harness --replay <file>` (or `--replay last`) re-renders a logged Run with the same header, markdown replies, tool lines and summary as a live Run, using the same `InkRunView`. Plan 006 (model eval suite) will reuse the log parser built here to score Runs.

## Current state

### Log format (written by `src/run/run-loop.ts` via `src/log/run-log.ts`)

Each line is JSON with an `at` ISO timestamp, added by `openRunLog`, plus:

| `event`     | other fields                                                        | written at        |
| ----------- | ------------------------------------------------------------------- | ----------------- |
| `start`     | `task: string`, `model: string`, `options: RunOptions`              | `run-loop.ts:56`  |
| `assistant` | `text: string`, `calls: ToolCall[]` (+ `usage` once plan 002 lands) | `run-loop.ts:87`  |
| `tool`      | `call: ToolCall`, `ok: boolean`, `output: string`                   | `run-loop.ts:108` |
| `end`       | `endReason: string \| null`, `iterations: number`                   | `run-loop.ts:65`  |

`options` contains `think: boolean` (see `RunOptions` below). Thinking text is **not** logged, so replay cannot show thinking; that is accepted (see Out of scope).

`src/log/run-log.ts` (whole file):

```ts
export async function openRunLog(target: string, startedAt: Date): Promise<RunLog> {
  const harnessDirectory = join(target, ".harness");
  const runsDirectory = join(harnessDirectory, "runs");
  await mkdir(runsDirectory, { recursive: true });
  await writeFile(join(harnessDirectory, ".gitignore"), "*\n");
  const path = join(runsDirectory, `${startedAt.toISOString().replace(/[:.]/g, "-")}.jsonl`);
  return {
    path,
    record: (entry) =>
      appendFile(path, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`),
  };
}
```

Log files are named from the start time, e.g. `2026-10-19T10-00-00-000Z.jsonl`, so lexical order is chronological.

`src/tools/tool-call.ts`:

```ts
export interface ToolCall {
  id: string;
  name: ToolName;
  arguments: Record<string, unknown>;
}

export function isToolName(name: string): name is ToolName {
```

`src/tools/execute-tool.ts`: `export interface ToolOutcome { ok: boolean; output: string; }`

`src/run/run-loop.ts` (excerpts):

```ts
export interface RunOptions {
  target: string;
  model: string;
  think: boolean;
  numCtx: number;
  ...
}

export interface RunResult {
  endReason: string;
  iterations: number;
}
...
  await deps.log.record({ event: "end", endReason: state.endReason, iterations: state.iteration });
  return { endReason: state.endReason ?? "unknown", iterations: state.iteration };
...
  deps.view.replyStarted();
  const reply = await collectReply(deps.backend.chat(request, signal), deps.view);
  deps.view.replyEnded();
  messages.push({ role: "assistant", content: reply.text, tool_calls: reply.calls });
  await deps.log.record({ event: "assistant", text: reply.text, calls: reply.calls });
...
  deps.view.toolFinished(call, outcome);
  messages.push({ role: "tool", content: outcome.output, tool_name: call.name });
  await deps.log.record({ event: "tool", call, ...outcome });
```

A gated Tool Call also calls `deps.view.confirmationStarted()` before the Confirmer. That is not logged either; replay never calls it.

### The view

`src/view/run-view.ts` (whole interface):

```ts
export interface RunView {
  replyStarted(): void;
  thinkingText(text: string): void;
  replyText(text: string): void;
  replyEnded(): void;
  confirmationStarted(): void;
  toolFinished(call: ToolCall, outcome: ToolOutcome): void;
}
```

`src/view/ink-run-view.tsx` implements `RunView` and `Confirmer`. The header and summary are no longer written by `cli.ts`; they are blocks the view adds itself:

```ts
export interface RunHeader {
  model: string;
  backendUrl: string;
  logPath: string;
  task: string;
  think: boolean;
}

export interface InkRunViewIo {
  stdout: NodeJS.WriteStream;
  stdin: NodeJS.ReadStream;
  interactive: boolean;
  onInterrupt: () => void;
}

export class InkRunView implements RunView, Confirmer {
  ...
  start(header: RunHeader): void {
    this.instance = render(<RunApp ... interactive={this.io.interactive} ... />, ...);
    ...
    this.store.addBlock({ kind: "header", ...header, width });
    this.store.addBlock({ kind: "task", text: header.task });
  }

  async finish(result: RunResult, elapsedMs: number): Promise<void> {
    ...
    this.store.addBlock({ kind: "summary", ...result, elapsedMs, width });
    await this.close();
  }
```

With `interactive: false`, `RunApp` does not read keys (`useInput(..., { isActive: interactive })`), does not animate, and hides the footer. That is exactly the piped path a live Run uses today (`cli.ts` passes `isatty(0) && isatty(1)`), so replay always passes `interactive: false`: no raw mode, no spinner, and it works both on a TTY and piped into `cat`/`less -R`.

### Entry point

`src/cli.ts` (`main`, lines 18–52):

```ts
async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const config = await loadUserConfig();
  const model = chooseModel(args.model, config.defaultModel);
  const backendUrl = assertBackendAllowed(args.backend, config.allowedBackendHosts);
  const target = await prepareTargetDirectory(process.cwd(), args.allowDirty);
  const log = await openRunLog(target, new Date());
  const systemPrompt = await buildSystemPrompt(target);
  const view = new InkRunView({
    stdout: process.stdout,
    stdin: process.stdin,
    interactive: isatty(STDIN_FD) && isatty(STDOUT_FD),
    onInterrupt: () => process.exit(INTERRUPTED_EXIT_CODE),
  });
  view.start({
    model,
    backendUrl,
    logPath: log.path,
    task: args.task,
    think: args.runOptions.think,
  });
  const startedAt = Date.now();
  try {
    const result = await runTask(...);
    await view.finish(result, Date.now() - startedAt);
  } catch (error) {
    await view.close();
    throw error;
  }
}
```

`src/cli-args.ts` (relevant parts):

```ts
export interface CliArgs {
  task: string;
  model: string | undefined;
  backend: string;
  allowDirty: boolean;
  runOptions: Omit<RunOptions, "target" | "model">;
}

const USAGE = `usage: harness "task" [--model <name>] [--backend http://localhost:11434] [--yolo] [--allow-secrets] [--allow-dirty] [--think] [--num-ctx 32768] [--max-iterations 50] [--timeout-minutes 20]`;

export function parseCliArgs(argv: string[]): CliArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      model: { type: "string" },
      ...
    },
  });
  const task = positionals.join(" ").trim();
  if (task === "") throw new Error(USAGE);
```

### Test helpers that exist now

- `test/view/recording-view.ts` — `RecordingView implements RunView`; records `"reply-started"`, `"text:<chunk>"`, `"thinking:<chunk>"`, `"reply-ended"`, `"confirmation-started"`, `"tool:<name>:ok|fail"`; getter `text` joins the `text:` chunks.
- `test/backend/fake-backend.ts` — `new FakeBackend(turns: ChatChunk[][])`.
- `test/run/run-loop.test.ts` — the pattern for driving `runTask`. Its helpers (copy them, do not export them from there):

```ts
function options(flags: Partial<RunOptions["flags"]> = {}): RunOptions {
  return {
    target,
    model: "fake",
    think: false,
    numCtx: 1024,
    timeoutMs: 5000,
    limits: { maxIterations: 10, maxConsecutiveFailures: 3 },
    flags: { yolo: false, allowSecrets: false, ...flags },
  };
}

const toolCall = (name: "read" | "edit" | "shell", args: Record<string, unknown>): ChatChunk => ({
  type: "tool_call",
  call: { id: "c", name, arguments: args },
});
const text = (value: string): ChatChunk => ({ type: "text", text: value });
```

and its `beforeEach` makes the target with `realpath(await mkdtemp(join(tmpdir(), "harness-run-")))` and writes `a.txt` = `"hello\n"`.

- `test/log/run-log.test.ts` — writes a real log into an `mkdtemp` directory; the pattern for file-backed tests.

### Conventions to match

- Small single-purpose modules under `src/<area>/`, tests mirrored under `test/<area>/`.
- Narrow `unknown` with `typeof`/`Array.isArray`; no `any`, no `as` casts on untrusted data beyond the initial `JSON.parse(...) as unknown`.
- Dispatch on a key with a lookup object, not an if-chain (see `handlers` in `ink-run-view.tsx` and `blockLines` in `block-lines.ts`).
- **No code comments of any kind**, including lint suppressions. A hook rejects them.
- Glossary: **Run**, **Tool Call**, **Target Directory**. Avoid "session".

## Commands you will need

| Purpose   | Command                                                      | Expected on success |
| --------- | ------------------------------------------------------------ | ------------------- |
| Typecheck | `pnpm typecheck`                                             | exit 0              |
| Tests     | `pnpm vitest run test/log test/replay test/cli-args.test.ts` | all pass            |
| All gates | `.claude/verify`                                             | exit 0              |
| Dead code | `npx fallow --format json`                                   | `total_issues` 0    |

## Scope

**In scope**:

- `src/log/run-log-entry.ts` (create)
- `test/log/run-log-entry.test.ts` (create)
- `src/replay/replay-run.ts` (create)
- `test/replay/replay-run.test.ts` (create)
- `src/cli-args.ts`, `test/cli-args.test.ts`
- `src/cli.ts`
- `README.md` (flags table and one sentence)

**Out of scope**:

- `src/run/run-loop.ts` and the log format. Replay reads what exists; do not add fields (not thinking text, not `confirmationStarted`, not the backend URL).
- `src/view/**`. Replay drives `InkRunView` through its existing public methods. Do not add a replay mode to the view or the store.
- `test/view/recording-view.ts`. Extend it by subclassing in the replay test, not by editing it.
- Showing full tool output in replay (a `--full` flag). Possible follow-up; do not add it now.

## Git workflow

- Branch: `advisor/005-replay-run-log`.
- Conventional commits, e.g. `feat: parse run log entries`, then `feat: replay a run log with --replay`.
- Do not push or open a PR unless the operator told you to.

## Steps

### Step 1: Parse one log line (test first)

Create `src/log/run-log-entry.ts` exporting:

```ts
export type RunLogEntry =
  | { event: "start"; at: string; task: string; model: string; think: boolean }
  | { event: "assistant"; at: string; text: string; calls: ToolCall[] }
  | { event: "tool"; at: string; call: ToolCall; ok: boolean; output: string }
  | { event: "end"; at: string; endReason: string; iterations: number };

export function parseRunLogLine(line: string): RunLogEntry | null;
```

Rules:

- a blank line, invalid JSON, a non-object, an unknown `event`, or missing or wrongly typed fields → `null`;
- `start.think` is `options.think` when `options` is an object and `options.think` is a boolean; otherwise `false` (a missing or malformed `options` does not make the line `null`);
- `end.endReason` of `null` in the file becomes `"unknown"` (this matches what `runTask` returns);
- a `ToolCall` is valid when `name` is a string passing `isToolName`, `id` is a string, and `arguments` is a non-null, non-array object;
- other extra fields (the rest of `options`, `usage`) are ignored.

Write one small parser function per event and dispatch on `event` with a lookup object.

Tests in `test/log/run-log-entry.test.ts`: one valid line per event type; `start` with `options.think: true` → `think: true`; `start` without `options` → `think: false`; one test per `null` case listed above; and an `end` entry with `endReason: null` mapping to `"unknown"`.

**Verify**: `pnpm vitest run test/log` → all pass.

### Step 2: Replay entries into a view (test first)

Create `src/replay/replay-run.ts` exporting:

```ts
export interface ReplayView extends RunView {
  start(header: RunHeader): void;
  finish(result: RunResult, elapsedMs: number): Promise<void>;
}

export async function replayRun(
  entries: RunLogEntry[],
  logPath: string,
  view: ReplayView,
): Promise<void>;
```

Import `RunHeader` from `../view/ink-run-view.js` and `RunResult` from `../run/run-loop.js` as types. `InkRunView` satisfies `ReplayView` structurally; do not add `implements ReplayView` to it.

Behaviour, in entry order:

- `start` → `view.start({ model, backendUrl: "replay", logPath, task, think })`;
- `assistant` → `view.replyStarted()`, then `view.replyText(text)` when `text` is not empty, then `view.replyEnded()`;
- `tool` → `view.toolFinished(call, { ok, output })`;
- `end` → `await view.finish({ endReason, iterations }, Date.parse(end.at) - Date.parse(start.at))`, using `0` when there was no `start` entry, then return (ignore anything after `end`);
- if no `start` entry comes before the first other entry, call `view.start` first with `model: "unknown"`, `task: ""`, `think: false` so the view is rendered before any block is added;
- if no `end` entry exists, finish with `{ endReason: "log ended without an end entry", iterations: <number of assistant entries that had at least one call> }` and elapsed `0`;
- an empty `entries` array → throw `Error("the Run log has no readable entries")` without calling the view.

Tests in `test/replay/replay-run.test.ts`. Define a test double in the file:

```ts
class RecordingReplayView extends RecordingView implements ReplayView {
  header: RunHeader | null = null;
  result: RunResult | null = null;

  start(header: RunHeader): void {
    this.header = header;
  }

  finish(result: RunResult): Promise<void> {
    this.result = result;
    return Promise.resolve();
  }
}
```

1. **Round-trip.** Make the target as in `run-loop.test.ts` (`realpath(mkdtemp(...))`, `a.txt` = `"hello\n"`). Run `runTask("change hello to bye", "sys", options({ yolo: true }), { backend, confirmer, log, view: live })` with `FakeBackend([[toolCall("read", { path: "a.txt" })], [toolCall("edit", { path: "a.txt", old: "hello", new: "bye" })], [text("Done.")]])`, a real `log = await openRunLog(target, new Date())`, a `confirmer` whose `confirm` returns `Promise.reject(new Error("unexpected confirmation"))`, and `live = new RecordingView()`. `yolo: true` is required: a gated call makes the live view record `confirmation-started`, which the log does not carry. Then read `log.path`, split on `"\n"`, map through `parseRunLogLine`, drop the `null`s, and `await replayRun(entries, log.path, replayed)` with `replayed = new RecordingReplayView()`. Assert `replayed.events` equals `live.events`, `replayed.header` matches `{ model: "fake", backendUrl: "replay", logPath: log.path, task: "change hello to bye", think: false }`, and `replayed.result` equals the value `runTask` returned.
2. Entries with no `end` entry: `replayed.result?.endReason` is `"log ended without an end entry"`.
3. Entries without a `start` entry: `replayed.header?.model` is `"unknown"` and the other events still replay.
4. An empty array rejects with `/no readable entries/`.

**Verify**: `pnpm vitest run test/replay` → all pass.

### Step 3: Add `--replay` to the CLI arguments (test first)

In `src/cli-args.ts`:

- add the option `replay: { type: "string" }` and the field `replay: string | undefined` to `CliArgs`;
- require a non-empty task only when `replay` is `undefined`;
- append ` [--replay <file>|last]` to `USAGE`.

New tests in `test/cli-args.test.ts`:

- `parseCliArgs(["--replay", "last"]).replay` is `"last"` and does not throw;
- `parseCliArgs(["t"]).replay` is `undefined`;
- the existing `"requires a task"` test still throws.

**Verify**: `pnpm vitest run test/cli-args.test.ts` → all pass.

### Step 4: Wire `--replay` into `main`

Add to `src/replay/replay-run.ts`:

- `resolveReplayPath(argument: string, cwd: string): Promise<string>`: `"last"` → the lexically greatest `*.jsonl` in `join(cwd, ".harness", "runs")`; if the folder is missing or has none, throw `Error("no Run logs in .harness/runs")`. Anything else → returned unchanged.
- `readRunLog(path: string): Promise<RunLogEntry[]>`: read the file as UTF-8, split on `"\n"`, map through `parseRunLogLine`, drop the `null`s.

In `src/cli.ts`, right after `parseCliArgs` in `main`: when `args.replay !== undefined`, call a new local function `replayLog(args.replay)` and `return`. This happens before config loading, the backend check and `prepareTargetDirectory`, because replay needs neither a clean tree nor a backend. `replayLog`:

```ts
async function replayLog(argument: string): Promise<void> {
  const path = await resolveReplayPath(argument, process.cwd());
  const entries = await readRunLog(path);
  const view = new InkRunView({
    stdout: process.stdout,
    stdin: process.stdin,
    interactive: false,
    onInterrupt: () => process.exit(INTERRUPTED_EXIT_CODE),
  });
  try {
    await replayRun(entries, path, view);
  } catch (error) {
    await view.close();
    throw error;
  }
}
```

Keep `main` small (the repo prefers small single-purpose functions): if `main` grows past about 30 lines, move the live path into a `runLive(args: CliArgs)` function.

Add tests for `resolveReplayPath` and `readRunLog` to `test/replay/replay-run.test.ts`: in an `mkdtemp` directory with `.harness/runs/2026-01-01T00-00-00-000Z.jsonl` and `.harness/runs/2026-02-01T00-00-00-000Z.jsonl`, `"last"` resolves to the February file; a directory with no `.harness` rejects with `/no Run logs/`; `readRunLog` on a file with one valid line, one blank line and one garbage line returns one entry.

**If plan 002 is DONE** (`grep -n contextUsed src/view/run-view.ts` matches): read that method's signature and the `assistant` log entry in `run-loop.ts`. If it is `contextUsed(usage, numCtx)` with `usage` on `assistant` entries and `numCtx` in `start.options`, parse `usage` on `assistant` entries (as the same type 002 exported, or `null`) and `options.numCtx` on `start`, call `view.contextUsed(usage, numCtx)` right after `replyEnded` when both are present, and add a `usage` chunk to the round-trip test's last FakeBackend turn. If the shape is different, STOP and report what 002 actually added. If plan 002 is not done, skip this part.

**Verify**: `pnpm typecheck` → exit 0. `.claude/verify` → exit 0.

### Step 5: Document and try it

Add a row to the README flags table (around `README.md:23`, keep the column alignment Prettier wants): ``| `--replay` | off | Re-render a Run log (`last` = newest in `.harness/runs/`) instead of running |``. Append one sentence to the paragraph at `README.md:37` ("Every run writes a JSONL log…"): `` `harness --replay last` re-renders the newest one. ``

Then try it. In any repo with `.harness/runs/`, run both:

1. `/Users/jorden/src/local-agent-harness/bin/harness.js --replay last` in a real terminal;
2. `/Users/jorden/src/local-agent-harness/bin/harness.js --replay last | cat`.

If no repo has a log, create one first: in a scratch git repo with one commit, run `harness --yolo "read README and summarise it"` against a running Ollama. If Ollama is not available, say so in your report and rely on the round-trip test.

**Expected** (both): the `harness · <model> via replay` header, the `log …` line, the task, `●` replies, tool lines and the summary line; no footer, no spinner, the command exits on its own.

**Verify**: `npx fallow --format json` → `total_issues` 0. `pnpm lint` → exit 0.

## Test plan

- `test/log/run-log-entry.test.ts`: about 12 tests (Step 1).
- `test/replay/replay-run.test.ts`: round-trip, no-end, no-start, empty, 2 `resolveReplayPath` cases, 1 `readRunLog` case.
- `test/cli-args.test.ts`: 2 new tests.
- `pnpm test` → all pass.

## Done criteria

- [ ] `.claude/verify` exits 0
- [ ] `npx fallow --format json` reports `total_issues` 0
- [ ] The round-trip test exists, passes and asserts `replayed.events` equals `live.events`
- [ ] `grep -n 'replay' src/cli-args.ts` matches
- [ ] `git diff --stat d56080c -- src/run src/view test/view` is empty
- [ ] `git status` shows only in-scope files changed
- [ ] Both commands in Step 5 printed the header and summary (or the report says why they could not be run)
- [ ] `plans/README.md` row 005 updated

## STOP conditions

- The log fields written by `run-loop.ts` differ from the table above.
- The round-trip test cannot match event-for-event. If `RecordingView` events differ **only** in how `text:` events are split, compare `view.text` plus the non-text events instead, and note this in your report. For any other difference, STOP.
- `InkRunView` does not structurally satisfy `ReplayView` (typecheck error at the `replayRun(entries, path, view)` call). Do not change the view; report it.
- The piped replay (`| cat`) prints nothing or only the last frame. That is an Ink non-interactive problem shared with live Runs; report it rather than writing a fallback renderer.
- `parseArgs` rejects `--replay` used without a positional task in a way that the task-check change does not fix.

## Maintenance notes

- Any new log event or field should get a parser case here. Unknown events are skipped silently by design, so old logs keep replaying.
- Plan 006 (eval suite) imports `parseRunLogLine` and `RunLogEntry` from `src/log/run-log-entry.ts`; `tool` entries still carry `call`, `ok` and `output`. The `think` field on `start` is additive.
- Replay cannot show thinking or the gate prompt because neither is logged. If either matters later, add it to the log in `run-loop.ts` and a parser case here, as a separate change.
- The header shows `via replay` because the backend URL is not logged.
- Replay renders through `InkRunView`, so any future view change (new block kinds, layout) shows up in replay for free; anything added to `RunView` that the loop calls from logged data should be mirrored in `replayRun`.
