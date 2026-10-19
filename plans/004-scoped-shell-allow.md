# Plan 004: Scope "allow for this Run" on shell to one command prefix

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat d56080c..HEAD -- src/run/run-state.ts src/gate src/view/block-lines.ts src/view/live-lines.ts src/view/ink-run-view.tsx src/view/ink/footer.tsx test/run/run-state.test.ts test/gate test/view README.md`
> If any in-scope file changed since this plan was written, compare every
> "Current state" excerpt below against the live file. If plan 003 has
> landed, the gate files (`confirmation-keys.ts`, `ink-run-view.tsx`,
> `block-lines.ts`, `footer.tsx`) may differ for the decline reason; that is
> expected — keep 003's changes and apply only the edits this plan names.
> On any other mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: S–M
- **Risk**: MED (changes the safety model; a scoping bug could let a command run without Confirmation)
- **Depends on**: none (touches the same gate prompt as plan 003; run them one after the other)
- **Category**: direction
- **Planned at**: commit `d56080c`, 2026-10-19
- **Refreshed**: 2026-10-19 by reconcile — retargeted from the deleted `terminal-confirmer.ts` to the Ink gate (`block-lines.ts`, `live-lines.ts`, `footer.tsx`, `ink-run-view.tsx`); `a` stays a key for every gated call.

## Why this matters

At a Confirmation the user can press `a` to "allow every shell for this run". One `a` on `pnpm test` then lets the Model run any later command unasked, from `git reset --hard` to `npm publish`. Only a short denylist in `src/tools/confinement.ts` stands in the way, and the README admits shell is not sandboxed. Users therefore either keep pressing `y` or give up and use `--yolo`.

The project's own research recommends scoping: "a = allow for this run scoped by kind (edits to this file, or this command prefix)" (`docs/research/agent-tui-patterns.md:170`). After this plan, `a` on a shell call allows only later commands with the same **shell scope**: the program plus its first non-flag word, e.g. `pnpm test`. Commands that chain, substitute or redirect (`;`, `&`, `|`, `$`, `(`, `)`, backticks, `<`, `>`, `\`, newline) have no scope and can never be allowed for the Run; for them `a` acts like `y` and its label says so.

## Current state

### Files and roles

- `src/run/run-state.ts` — pure loop rules: `gateToolCall`, `needsConfirmation`, `recordConfirmation`. `allowedForRun: ToolName[]` holds tools allowed with `a`.
- `src/gate/confirmation-keys.ts` — maps keys to `y` / `n` / `a`. Its `CHOICE_ORDER` is used by the Ink view for the option list and arrow selection. **Do not change it.**
- `src/view/block-lines.ts` — defines `GatePrompt` and `choiceLabel`, and renders the answered gate block.
- `src/view/live-lines.ts` — renders the pending gate with one option row per `CHOICE_ORDER` entry.
- `src/view/ink/footer.tsx` — key hints shown under the gate.
- `src/view/ink-run-view.tsx` — `confirm(call, preview)` builds the `GatePrompt`.
- `src/tools/confinement.ts` — the shell denylist. It runs **before** the gate in `gateToolCall` and stays authoritative. **Do not change it** (plans 008 and 009 edit it).

### Excerpts

`src/run/run-state.ts:13-20, 26-37, 51-69`:

```ts
export interface RunState {
  limits: RunLimits;
  flags: RunFlags;
  iteration: number;
  consecutiveFailures: number;
  allowedForRun: ToolName[];
  endReason: string | null;
}

const GATED_TOOLS: ReadonlySet<ToolName> = new Set(["write", "edit", "shell"]);

export function initialRunState(limits: RunLimits, flags: RunFlags): RunState {
  return {
    limits,
    flags,
    iteration: 0,
    consecutiveFailures: 0,
    allowedForRun: [],
    endReason: null,
  };
}

  return {
    state: counted,
    gate: { kind: needsConfirmation(counted, call.name) ? "confirm" : "run" },
  };
}

function needsConfirmation(state: RunState, tool: ToolName): boolean {
  return GATED_TOOLS.has(tool) && !state.flags.yolo && !state.allowedForRun.includes(tool);
}

export function recordConfirmation(
  state: RunState,
  call: ToolCall,
  choice: ConfirmationChoice,
): { state: RunState; proceed: boolean } {
  if (choice === "n") return { state: recordToolOutcome(state, false), proceed: false };
  const allowedForRun = choice === "a" ? [...state.allowedForRun, call.name] : state.allowedForRun;
  return { state: { ...state, allowedForRun }, proceed: true };
}
```

`src/view/block-lines.ts:22-26` and `:73-77`:

```ts
export interface GatePrompt {
  question: string;
  preview: string;
  toolName: ToolName;
}

export function choiceLabel(choice: ConfirmationChoice, toolName: ToolName): string {
  if (choice === "y") return "yes";
  if (choice === "n") return "no";
  return `allow every ${toolName} for this run`;
}
```

`choiceLabel` is called in two places: `src/view/block-lines.ts:167` (`choiceLabel(block.choice, block.prompt.toolName)`) and `src/view/live-lines.ts:75` (`choiceLabel(choice, prompt.toolName)`). `toolName` is read nowhere else except the footer.

`src/view/ink/footer.tsx:23-31`:

```tsx
function gateHints(state: RunViewState): Hint[] {
  if (state.live.kind !== "gate") return [];
  return [
    ["y", "yes"],
    ["n", "no"],
    ["a", `allow every ${state.live.prompt.toolName}`],
    ["esc", "counts as no"],
  ];
}
```

`src/view/ink-run-view.tsx:107-115`:

```ts
  confirm(call: ToolCall, preview: string): Promise<ConfirmationChoice> {
    if (!this.io.interactive)
      throw new Error("confirmation needs an interactive terminal; rerun with --yolo");
    const prompt = { question: `Allow ${describeToolCall(call)}?`, preview, toolName: call.name };
    this.store.openGate(prompt, this.terminalRows() - FOOTER_ROWS);
    return new Promise((resolve) => {
      this.answer = resolve;
    });
  }
```

`src/tools/tool-call.ts:15-19` (`stringArgument` throws on a missing argument; do **not** use it in the gate):

```ts
export function stringArgument(call: ToolCall, key: string): string {
  const value = call.arguments[key];
  if (typeof value !== "string") throw new Error(`${call.name} needs a string "${key}" argument`);
  return value;
}
```

Tests that build a `GatePrompt` literal with `toolName: "shell"` (all must switch to `allowLabel`):

- `test/view/block-lines.test.ts:116` — `const prompt = { question: "Allow shell: ls?", preview: "$ ls", toolName: "shell" as const };` and expects `"◇ Allow shell: ls? · allow every shell for this run"` at `:127`.
- `test/view/live-lines.test.ts:13` — `const prompt: GatePrompt = { question: "Allow shell: ls?", preview: "$ ls", toolName: "shell" };` and expects `"│ ○ allow every shell for this run"` at `:53`.
- `test/view/run-store.test.ts:8-12` — `shellPrompt: GatePrompt` with `toolName: "shell"`.
- `test/view/ink/run-app.test.tsx:33-37` — `store.openGate({ ..., toolName: "shell" }, 40)` and expects the footer text `"y yes   n no   a allow every shell   esc counts as no   t thinking on"`.

Existing allow-for-run test, `test/run/run-state.test.ts:64-67`, which uses `edit` and must keep passing unchanged:

```ts
it("remembers allow-for-run per tool", () => {
  const { state } = recordConfirmation(gateToolCall(start(), edit).state, edit, "a");
  expect(gateToolCall(state, edit).gate).toEqual({ kind: "run" });
});
```

README "Safety model" bullet, `README.md:44`: ``- `write`, `edit` and `shell` ask for confirmation with a diff or command preview. `a` allows that tool for the rest of the run. `--yolo` skips the gate.``

### Conventions to match

- Rules stay pure functions over `RunState`. Tests call them directly, as `test/run/run-state.test.ts` does (it defines `ToolCall` constants at the top and a `start()` helper).
- Table tests: see `test/gate/confirmation-keys.test.ts` for the `describe`/`it` style in `test/gate`.
- **No code comments of any kind**, including lint suppressions. A hook rejects them.
- Kebab-case files, `.js` import suffixes, strict TS, Prettier formatting.
- Glossary: **Confirmation**, **Run**, **Tool Call**. Call the new concept "shell scope" in names (`shellScope`, `allowedShellScopes`).

## Commands you will need

| Purpose   | Command                                        | Expected on success |
| --------- | ---------------------------------------------- | ------------------- |
| Typecheck | `pnpm typecheck`                               | exit 0              |
| Tests     | `pnpm vitest run test/run test/gate test/view` | all pass            |
| All gates | `.claude/verify`                               | exit 0              |
| Dead code | `npx fallow --format json`                     | `total_issues` 0    |

## Scope

**In scope**:

- `src/gate/shell-scope.ts` (create)
- `test/gate/shell-scope.test.ts` (create)
- `src/run/run-state.ts`
- `test/run/run-state.test.ts`
- `src/view/block-lines.ts` (`GatePrompt`, `choiceLabel`, its call in `gateLines`)
- `src/view/live-lines.ts` (the one `choiceLabel` call)
- `src/view/ink/footer.tsx` (the `a` hint)
- `src/view/ink-run-view.tsx` (the prompt object in `confirm`)
- `test/view/block-lines.test.ts`, `test/view/live-lines.test.ts`, `test/view/run-store.test.ts`, `test/view/ink/run-app.test.tsx` (prompt literals and the footer expectation only)
- `README.md` (the one Safety-model bullet)

**Out of scope**:

- `src/tools/confinement.ts` and its denylist.
- `src/gate/confirmation-keys.ts` and `CHOICE_ORDER`: `a` stays a key on every prompt.
- `src/view/run-store.ts`.
- `write`/`edit` allow-for-run. Keep it per tool, as it is today.
- Persisting allowed scopes across Runs (no config-file rules).
- `--yolo` behaviour.

## Git workflow

- Branch: `advisor/004-scoped-shell-allow`.
- Conventional commit, e.g. `feat: scope allow-for-run on shell to a command prefix`.
- Do not push or open a PR unless the operator told you to.

## Steps

### Step 1: `shellScope` and `allowForRunLabel` (test first)

Create `test/gate/shell-scope.test.ts` with an `it.each` table for `shellScope(command): string | null`:

| command                                | expected    |
| -------------------------------------- | ----------- |
| `pnpm test`                            | `pnpm test` |
| ` pnpm   test --watch`                 | `pnpm test` |
| `ls -la`                               | `ls`        |
| `ls`                                   | `ls`        |
| `git push origin main`                 | `git push`  |
| `pnpm test && rm -rf x`                | `null`      |
| `echo hi; rm x`                        | `null`      |
| `cat a \| sh`                          | `null`      |
| `` echo `id` ``                        | `null`      |
| `echo $(id)`                           | `null`      |
| `echo $HOME`                           | `null`      |
| `echo hi > a.txt`                      | `null`      |
| `sort < a.txt`                         | `null`      |
| a command with a newline, `"ls\nrm x"` | `null`      |
| `""` and `"   "`                       | `null`      |

Add a second `describe("allowForRunLabel")` for `allowForRunLabel(call: ToolCall): string`:

- shell `pnpm test --watch` → `allow "pnpm test …" for this run`
- shell `pnpm test && rm x` → `yes, once (this command can't be allowed for the run)`
- shell with no `command` argument → the same "yes, once" label (must not throw)
- edit → `allow every edit for this run`

Then create `src/gate/shell-scope.ts`, importing only from `../tools/tool-call.js`:

- `const UNSCOPABLE = /[;&|`$()<>\n\\]/;`
- `export function shellScope(command: string): string | null` — trim; return `null` if empty or matching `UNSCOPABLE`; split on `/\s+/`; if a second token exists and does not start with `-`, return the first two tokens joined by one space; otherwise the first token.
- `export function shellCommand(call: ToolCall): string` — `call.arguments["command"]` when it is a string, otherwise `""`.
- `export function allowForRunLabel(call: ToolCall): string` — for non-shell calls return `` `allow every ${call.name} for this run` ``; for shell compute `shellScope(shellCommand(call))` and return `` `allow "${scope} …" for this run` `` or the "yes, once" label when it is `null`.

**Verify**: `pnpm vitest run test/gate/shell-scope.test.ts` → all pass.

### Step 2: Scope the rule in `run-state.ts` (test first)

Add to `test/run/run-state.test.ts`, next to the existing constants, `const shell = (command: string): ToolCall => ({ id: "s", name: "shell", arguments: { command } });` and these tests under `describe("recordConfirmation")`:

1. `a` on `pnpm test` → a later `pnpm test --watch` gates as `{ kind: "run" }`.
2. `a` on `pnpm test` → a later `pnpm install` gates as `{ kind: "confirm" }`.
3. `a` on `pnpm test && rm x` → `proceed` is `true`, but a later identical call gates as `{ kind: "confirm" }`.
4. `a` on `pnpm test` → a later `edit` still gates as `{ kind: "confirm" }`.

Pattern each on the existing `"remembers allow-for-run per tool"` test: `recordConfirmation(gateToolCall(start(), call).state, call, "a")`, then `gateToolCall(state, laterCall).gate`.

Implement:

- add `allowedShellScopes: string[]` to `RunState`, initialised to `[]` in `initialRunState`;
- change `needsConfirmation(state, call: ToolCall)` and its caller in `gateToolCall` to pass `call`, not `call.name`. Keep `GATED_TOOLS.has(call.name) && !state.flags.yolo && !isAllowedForRun(state, call)`;
- `isAllowedForRun(state, call)`: for `shell`, true only if `shellScope(shellCommand(call))` is not `null` and is in `state.allowedShellScopes`; for other tools, `state.allowedForRun.includes(call.name)`;
- in `recordConfirmation`, on `"a"`: for `shell`, add the scope to `allowedShellScopes` when it is not `null` (add nothing when `null`); for other tools, keep today's `allowedForRun` behaviour. Use one small helper (e.g. `rememberAllow(state, call)`) so `recordConfirmation` stays short.

**Verify**: `pnpm vitest run test/run` → all pass, including the 4 new tests and the unchanged `"remembers allow-for-run per tool"`.

### Step 3: Make sure a stray `"shell"` in `allowedForRun` cannot bypass the scope

Add one more test: build a state with `{ ...start(), allowedForRun: ["shell"] }` and assert that `gateToolCall(state, shell("ls")).gate` is `{ kind: "confirm" }`. Step 2's `isAllowedForRun` already makes this pass; if it does not, fix `isAllowedForRun`, not the test.

Then run `grep -n "allowedForRun" src/run/run-state.ts` and confirm no line adds `shell` to it.

**Verify**: `pnpm vitest run test/run/run-state.test.ts` → all pass.

### Step 4: Show the scope in the gate

1. In `src/view/block-lines.ts`, replace the `GatePrompt` field `toolName: ToolName` with `allowLabel: string`. Change `choiceLabel(choice, allowLabel: string)` to return `allowLabel` for `"a"`. Update the call in `gateLines` to `choiceLabel(block.choice, block.prompt.allowLabel)`. Remove the `ToolName` import if it becomes unused.
2. In `src/view/live-lines.ts:75`, call `choiceLabel(choice, prompt.allowLabel)`.
3. In `src/view/ink/footer.tsx`, change the hint to `["a", "allow for this run"]` (the option list shows the full label).
4. In `src/view/ink-run-view.tsx` `confirm`, build the prompt as `{ question: ..., preview, allowLabel: allowForRunLabel(call) }`, importing `allowForRunLabel` from `../gate/shell-scope.js`.
5. In the four view tests listed under "Current state", replace `toolName: "shell"` (or `"shell" as const`) with `allowLabel: "allow every shell for this run"`, so their expected option and answer rows stay unchanged. In `test/view/ink/run-app.test.tsx` change the expected footer to `"y yes   n no   a allow for this run   esc counts as no   t thinking on"`.

If plan 003 has already landed, these files also contain the decline-reason changes. Keep them; change only the lines above.

**Verify**: `pnpm typecheck` → exit 0. `pnpm vitest run test/view` → all pass. `grep -rn "toolName" src/view test/view` → no matches.

### Step 5: Update README and run the gates

Replace the Safety-model sentence `` `a` allows that tool for the rest of the run. `` (`README.md:44`) with: `` `a` allows `write` or `edit` for the rest of the run; for `shell` it allows only commands with the same program and first argument (e.g. `pnpm test`), and never commands containing `;`, `&`, `|`, `$`, `(`, `)`, backticks, `<`, `>` or `\`. ``

**Verify**: `.claude/verify` → exit 0. `npx fallow --format json` → `total_issues` 0.

### Step 6: Check it by hand

In a scratch git repo (`git init`, one commit), run `pnpm harness` from this repo against it and ask it to "run `ls`, then `ls -la`, then `pwd`". At the first prompt the `a` option must read `allow "ls …" for this run`; press `a`.

**Expected**: `ls -la` runs unasked and `pwd` prompts again. Report what you saw. If no local model is available, say so and skip this step.

## Test plan

- `test/gate/shell-scope.test.ts`: about 15 `shellScope` rows and 4 `allowForRunLabel` cases.
- `test/run/run-state.test.ts`: 5 new tests (4 in Step 2, 1 in Step 3).
- Four view tests: prompt literals switched to `allowLabel`; one footer expectation changed.
- `pnpm test` → all pass.

## Done criteria

- [ ] `.claude/verify` exits 0
- [ ] `npx fallow --format json` reports `total_issues` 0
- [ ] `grep -n "allowedShellScopes" src/run/run-state.ts` matches
- [ ] `grep -rn "toolName" src/view test/view` → no matches
- [ ] `git diff --stat d56080c -- src/tools/confinement.ts src/gate/confirmation-keys.ts src/view/run-store.ts` is empty
- [ ] `git status` shows only in-scope files changed
- [ ] `plans/README.md` row 004 updated

## STOP conditions

- The `run-state.ts` excerpts do not match the live file.
- An existing test in `test/run/run-loop.test.ts` fails because it relied on `a` allowing every shell command. Report the test name; do not weaken the new rule to make it pass.
- Removing `GatePrompt.toolName` breaks a file not listed in Scope. Report the file instead of editing it.
- You find you need to parse shell syntax beyond the `UNSCOPABLE` character check (quotes, env-var prefixes such as `FOO=1 cmd`). Report the case instead; the plan deliberately accepts that `FOO=1 pnpm test` scopes to `FOO=1 pnpm`.

## Maintenance notes

- The scope is a convenience boundary, not a sandbox. `pnpm test` scope still runs whatever the `test` script does. Real isolation is the separate "Sandbox" idea that `GLOSSARY.md` reserves for later.
- `a` stays on every prompt because the Ink view's option list and arrow selection both come from the fixed `CHOICE_ORDER`. For an unscopable command it behaves like `y`, and the label says so. Hiding `a` per prompt would mean per-prompt choice lists in `confirmation-keys.ts`, `run-store.ts` and `live-lines.ts`; do that only if users find the label confusing.
- Any new shell metacharacter risk, e.g. `\r`, is handled by extending `UNSCOPABLE` and the test table together.
- A reviewer should read `isAllowedForRun` closely: every path for `shell` must reach a `confirm` unless a non-null scope matches exactly.
- Plan 003 edits the same gate files (prompt, footer, `ink-run-view.tsx`); land the two one after the other.
