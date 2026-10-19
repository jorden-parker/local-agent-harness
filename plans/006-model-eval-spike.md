# Plan 006 (spike): A small model eval suite that answers "which local Model should this machine use?"

> **Executor instructions**: This is a **spike**. The deliverables are a
> minimal working script and a findings document, not a polished feature.
> Follow the steps, run every verification command, and honour the STOP
> conditions. When done, update the status row for this plan in
> `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 9d2cb42..HEAD -- src/run/run-loop.ts src/log src/backend/ollama-backend.ts src/prompt/system-prompt.ts package.json`
> Plan 005 must be DONE first: `test -f src/log/run-log-entry.ts && echo ok`
> must print `ok`. If it does not, STOP.

## Status

- **Priority**: P3
- **Effort**: M (spike; a full suite would be L)
- **Risk**: LOW (new files only; runs Models locally under `--yolo`-equivalent flags inside throwaway temp repos)
- **Depends on**: plans/005-replay-run-log.md (reuses `parseRunLogLine`)
- **Category**: direction
- **Planned at**: commit `9d2cb42`, 2026-10-19

## Why this matters

The harness targets small local Qwen Models, and which one works is the main question every user faces. Today that knowledge is anecdotal. The README's "Known small-model quirks" lists one observation, the per-machine `defaultModel` is picked by hand, and `test/live/` holds one smoke test.

The project's own research left these open (`docs/research/agent-tui-patterns.md`, "Open questions to spike"):

> 5. **Small-model tool calling via Ollama.** Which local models reliably emit tool calls in Ollama's format, and do they need a search/replace edit format? Run a fixed set of 5 tasks per model and count malformed edits.
> 6. **Edit format.** Compare whole-file, search/replace, and unified-diff output on the same task for the target small model. Pick one as default with the others as fallbacks.

This spike answers question 5 with data, for the Models pulled on this machine. Question 6 is explicitly deferred.

## Current state

### Files and roles

- `src/run/run-loop.ts` — `runTask(task, systemPrompt, options, deps)` returns `{ endReason, iterations }`. `FINAL_ANSWER_REASON` is `"model gave a final answer"`.
- `src/backend/ollama-backend.ts` — `new OllamaBackend(baseUrl)`.
- `src/prompt/system-prompt.ts` — `buildSystemPrompt(target)`.
- `src/log/run-log.ts` — `openRunLog(target, startedAt)` returns `{ path, record }`.
- `src/log/run-log-entry.ts` (from plan 005) — `parseRunLogLine(line): RunLogEntry | null`; `tool` entries carry `call`, `ok` and `output`.
- `test/live/ollama.live.test.ts` — **the pattern to copy** for driving a real Run programmatically. Excerpt (`:26-55`):

```ts
const target = await realpath(await mkdtemp(join(tmpdir(), "harness-live-")));
await run("git", ["init", "-q"], { cwd: target });
await writeFile(join(target, "greeting.txt"), "hello world\n");
const log = await openRunLog(target, new Date());
const result = await runTask(
  "In greeting.txt replace the word hello with goodbye. Use the edit tool, then reply done.",
  await buildSystemPrompt(target),
  {
    target,
    model: MODEL,
    think: false,
    numCtx: 8192,
    timeoutMs: 180_000,
    limits: { maxIterations: 8, maxConsecutiveFailures: 3 },
    flags: { yolo: true, allowSecrets: false },
  },
  {
    backend: new OllamaBackend("http://localhost:11434"),
    confirmer: { confirm: () => Promise.resolve("y") },
    log,
    view: {
      replyStarted: () => undefined,
      replyText: () => undefined,
      replyEnded: () => undefined,
      toolFinished: () => undefined,
    },
  },
);
```

The `confirmer` and `view` literals may look different if plans 002–004 have landed. Copy their **current** shape from the live test file, not from this excerpt.

- `package.json` scripts: `harness` = `tsx src/cli.ts`, `test`, `test:live`, `typecheck`, `lint`. `tsx` is a devDependency.
- Models on the planning machine (`ollama list`): `qwen3:4b-instruct-2507-q4_K_M`, `qwen3:4b`, `qwen3:8b-q4_K_M`. Yours may differ.

### Conventions to match

- TypeScript, ESM, `.js` import suffixes, kebab-case files, small functions.
- **No code comments of any kind**, including lint suppressions. A hook rejects them.
- `tsconfig.json` `include` is `["src", "test", "vitest.config.ts", "eslint.config.js"]`. New code under `eval/` must be added there so `pnpm typecheck` and eslint cover it.
- Glossary: **Model**, **Run**, **Tool Call**, **Target Directory**.

## Commands you will need

| Purpose   | Command                                           | Expected on success          |
| --------- | ------------------------------------------------- | ---------------------------- |
| Ollama up | `curl -s localhost:11434/api/tags \| head -c 100` | JSON with `models`           |
| Typecheck | `pnpm typecheck`                                  | exit 0                       |
| All gates | `.claude/verify`                                  | exit 0                       |
| Eval      | `pnpm eval --model <name> [--model <name> ...]`   | a results table on stdout    |
| Dead code | `npx fallow --format json`                        | no findings in changed files |

## Scope

**In scope**:

- `eval/` (create): `eval/run-eval.ts`, `eval/eval-tasks.ts`, `eval/score-run.ts`
- `test/eval/score-run.test.ts` (create)
- `package.json`: add the script `"eval": "tsx eval/run-eval.ts"`; no new dependencies
- `tsconfig.json`: add `"eval"` to `include`
- `docs/research/model-eval.md` (create): the findings

**Out of scope**:

- Any change under `src/`. If the harness needs a change to be evaluable, STOP and report it.
- Edit-format comparison (research question 6).
- CI integration or vitest wiring of the eval itself. It is slow and needs local Models.

## Git workflow

- Branch: `advisor/006-model-eval-spike`.
- Conventional commits, e.g. `feat: add a model eval spike` and `docs: record model eval findings`.
- Do not push or open a PR unless the operator told you to.

## Steps

### Step 1: Score a Run from its log (test first)

Create `eval/score-run.ts`:

```ts
export interface RunScore {
  passed: boolean;
  endReason: string;
  toolCalls: number;
  failedToolCalls: number;
  failedEdits: number;
  seconds: number;
}

export function scoreRun(logLines: string[], passed: boolean): RunScore;
```

- Parse each line with `parseRunLogLine` and drop the `null`s.
- `toolCalls` is the number of `tool` entries; `failedToolCalls` is those with `ok === false`; `failedEdits` is failed entries where `call.name === "edit"`.
- `endReason` comes from the `end` entry, or `"no end entry"`.
- `seconds` is end `at` minus start `at`, rounded, or `0`.

Tests in `test/eval/score-run.test.ts`: build log lines with `JSON.stringify` for a start entry, one ok read, one failed edit, and an end entry. Assert every field. Add one case with no end entry.

**Verify**: `pnpm vitest run test/eval` → all pass. (`vitest.config.ts` includes `test/**/*.test.ts`, so this is picked up.)

### Step 2: Define five tasks

Create `eval/eval-tasks.ts` exporting `EVAL_TASKS: EvalTask[]`, where:

```ts
export interface EvalTask {
  name: string;
  files: Record<string, string>;
  prompt: string;
  passes: (target: string) => Promise<boolean>;
}
```

Use exactly these five, kept tiny and deterministic. Each `passes` reads files with `node:fs/promises`; none needs network or a package install.

1. `rename-word` — `greeting.txt` = `hello world\n`; prompt "In greeting.txt replace hello with goodbye."; passes when the file is exactly `goodbye world\n`.
2. `fix-off-by-one` — `sum.js` with a loop `for (let i = 1; i < xs.length; i++)` that skips index 0, plus `check.js` that `require`s it and exits 1 when `sum([1,2,3]) !== 6`; prompt "node check.js fails. Fix sum.js so it passes."; passes when `node check.js` exits 0 (use `execFile`).
3. `add-function` — `math.js` exporting `add`; prompt "Add and export a function multiply(a, b) to math.js."; passes when `require(join(target, "math.js")).multiply(3, 4) === 12`. Use `createRequire` from `node:module`, and a fresh process via `execFile("node", ["-e", ...])` to avoid the require cache.
4. `multi-file-edit` — `a.txt` and `b.txt` both contain `TODO`; prompt "Replace TODO with DONE in every .txt file."; passes when neither file contains `TODO`.
5. `find-and-report` — `src/one.js`, `src/two.js`, and `src/three.js` where only `two.js` contains `secretNumber = 42`; prompt "Create answer.txt containing only the file path that defines secretNumber."; passes when `answer.txt` trimmed ends with `src/two.js`.

**Verify**: `pnpm typecheck` → exit 0 (after Step 4 adds `eval` to `tsconfig.json`; run it again then).

### Step 3: The runner

Create `eval/run-eval.ts`. It is executed by `tsx`:

- parse `--model` (repeatable; use `parseArgs` with `multiple: true`) and `--num-ctx` (default `16384`) with `node:util` `parseArgs`;
- for each Model, then each task: create a `mkdtemp` directory, write `files`, run `git init -q`, `git add -A` and `git -c user.email=eval@local -c user.name=eval commit -qm init`, open a Run log there, and call `runTask` exactly as the live test does. Use `flags: { yolo: true, allowSecrets: false }`, `maxIterations: 15`, `timeoutMs: 300_000`, a no-op view and an always-yes confirmer. Then call `passes(target)`, read the log, and `scoreRun`;
- print one Markdown table to stdout with the columns `model | task | pass | end reason | tool calls | failed | failed edits | s`, followed by a per-Model total row (passes out of 5, failed edits, total seconds);
- keep the temp directories and print their parent path at the end so logs can be replayed with `harness --replay <file>`.

Run tasks sequentially. Parallel runs on one Ollama would distort the timings.

**Verify**: `pnpm typecheck` → exit 0 (after Step 4).

### Step 4: Wire the script and type coverage

Add `"eval": "tsx eval/run-eval.ts"` to `package.json` scripts and `"eval"` to `tsconfig.json` `include`.

**Verify**: `.claude/verify` → exit 0. `npx fallow --format json` → no findings in changed files. If fallow flags `eval/run-eval.ts` as an unused entry, add it to fallow's entry configuration **only if** a config file for that already exists in the repo; otherwise report it.

### Step 5: Run it and write the findings

With Ollama up, run `pnpm eval` once with every instruct or tool-capable Qwen Model shown by `ollama list`. On the planning machine that is `--model qwen3:4b-instruct-2507-q4_K_M --model qwen3:8b-q4_K_M --model qwen3:4b`.

Create `docs/research/model-eval.md` with:

- date, Ollama version (`ollama --version`), machine (`uname -m`, RAM via `sysctl -n hw.memsize` on macOS), harness commit;
- the results table, pasted verbatim;
- a direct answer to research question 5: which Models emitted valid tool calls reliably, and how many edits failed (the `"old" must appear exactly once` errors);
- a recommended `defaultModel` for this machine, one sentence;
- "Not answered": question 6 (edit formats), and the fact that the sample size is 1 Run per task.

Match the style of `docs/research/tui-libraries.md`: plain prose, short sections, and sources or commands stated.

**Verify**: `pnpm exec prettier --check docs/research/model-eval.md` → exit 0.

## Test plan

- `test/eval/score-run.test.ts`: 2 tests (full log, no end entry).
- The eval itself is not a test; Step 5 is its verification.
- `pnpm test` → all pass, with no Ollama needed.

## Done criteria

- [ ] `.claude/verify` exits 0
- [ ] `pnpm eval --model <any pulled model>` prints a table with 5 task rows and a total row
- [ ] `docs/research/model-eval.md` exists and contains a results table and a recommended `defaultModel`
- [ ] `git diff --stat 9d2cb42 -- src` shows no changes made by this plan
- [ ] `plans/README.md` row 006 updated

## STOP conditions

- Plan 005 is not DONE.
- Running a Run programmatically requires changing anything under `src/`.
- A task's `passes` check is flaky across two runs of the same Model with an unchanged result. Report which task.
- A single Model takes more than 30 minutes for the five tasks. Report the timing instead of finishing the matrix.

## Maintenance notes

- Each run of the suite costs real time and appends results only to stdout. Keep `docs/research/model-eval.md` as a dated snapshot, not a living table.
- When edit-format work (research question 6) starts, add tasks here first and compare before and after.
- If plan 002's `usage` field is in the logs, a natural next column is the peak context per Run; `scoreRun` is the place to add it.
