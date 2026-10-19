# Plan 003: Let a declined Tool Call carry the user's reason back to the Model

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat d56080c..HEAD -- src/gate src/run/run-loop.ts src/view test/gate test/view test/run/run-loop.test.ts test/live/ollama.live.test.ts`
> If any in-scope file changed since this plan was written, compare every
> "Current state" excerpt below against the live file; on any mismatch, STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW (gate rules are unchanged; only the text sent to the Model and the gate's key handling change)
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `d56080c`, 2026-10-19
- **Refreshed**: 2026-10-19, retargeted from the deleted `@clack/prompts` `TerminalConfirmer` to the Ink gate (`InkRunView` + `RunStore`) after plan 011.

## Why this matters

Before `write`, `edit` and `shell` run, the harness asks the user y / n / a (the **Confirmation**). The system prompt tells the Model: "Some tool calls need the user's approval; if one is declined, explain and try another approach." But on "n" the Model only receives `the user declined this tool call`. It has no idea why, so small models often retry the same call until three failures end the Run.

After this plan, choosing **no** opens a one-line "why?" field in the live region. Enter sends what was typed; Enter on an empty field, or Esc, sends no reason. A typed reason is appended to the tool result, e.g. `the user declined this tool call: use pnpm, not npm`. This is the cheapest steering a user has over a small Model. Claude Code offers the same affordance (a comment field on the permission answer), as noted in `docs/research/agent-tui-patterns.md`.

## Current state

### Files and roles

- `src/gate/confirmer.ts` — the `Confirmer` interface.
- `src/gate/confirmation-keys.ts` — pure key mapping for the pending gate (`readGateKey`), unit-tested in `test/gate/confirmation-keys.test.ts`.
- `src/view/ink-run-view.tsx` — `InkRunView` implements both `RunView` and `Confirmer`. `confirm` opens the gate in the store and returns a promise; `handleGateKey` resolves it. It has no unit test (needs a TTY); covered by the manual check in Step 7.
- `src/view/run-store.ts` — `RunStore` holds the view state: `openGate`, `moveGateSelection`, `answerGate`.
- `src/view/live-lines.ts` — the `Live` union and its renderers (what is drawn below scrollback).
- `src/view/block-lines.ts` — the `Block` union; `gateLines` draws an answered gate into scrollback.
- `src/view/ink/footer.tsx` — key hints; `gateHints` while a gate is open.
- `src/run/run-state.ts` — `ConfirmationChoice = "y" | "n" | "a"`; `recordConfirmation(state, call, choice)` applies the loop rules. **Do not change this file.**
- `src/run/run-loop.ts` — `resolveGate` calls the confirmer and builds the decline message.
- Tests: `test/run/run-loop.test.ts` (`scriptedConfirmer`), `test/live/ollama.live.test.ts` (inline confirmer), `test/view/run-store.test.ts`, `test/view/live-lines.test.ts`, `test/view/block-lines.test.ts`, `test/view/ink/run-app.test.tsx` (Footer).

### Excerpts

`src/gate/confirmer.ts` (whole file):

```ts
import type { ConfirmationChoice } from "../run/run-state.js";
import type { ToolCall } from "../tools/tool-call.js";

export interface Confirmer {
  confirm(call: ToolCall, preview: string): Promise<ConfirmationChoice>;
}
```

`src/gate/confirmation-keys.ts` (whole file):

```ts
import type { Key } from "ink";
import type { ConfirmationChoice } from "../run/run-state.js";

export type GateKeyAction =
  | { kind: "answer"; choice: ConfirmationChoice }
  | { kind: "move"; step: number }
  | { kind: "submit" }
  | { kind: "none" };

export const CHOICE_ORDER: readonly ConfirmationChoice[] = ["y", "n", "a"];

export function readGateKey(input: string, key: Key): GateKeyAction {
  if (key.escape || (key.ctrl && input === "c")) return { kind: "answer", choice: "n" };
  if (key.return) return { kind: "submit" };
  if (key.upArrow || key.downArrow) return { kind: "move", step: key.downArrow ? 1 : -1 };
  const choice = CHOICE_ORDER.find((option) => option === input);
  return choice === undefined ? { kind: "none" } : { kind: "answer", choice };
}
```

`src/view/ink-run-view.tsx` — field (line 44), `confirm` (107-115), input routing (117-126), gate keys (148-164), choice helpers (180-191):

```tsx
  private answer: ((choice: ConfirmationChoice) => void) | null = null;
```

```tsx
  confirm(call: ToolCall, preview: string): Promise<ConfirmationChoice> {
    if (!this.io.interactive)
      throw new Error("confirmation needs an interactive terminal; rerun with --yolo");
    const prompt = { question: `Allow ${describeToolCall(call)}?`, preview, toolName: call.name };
    this.store.openGate(prompt, this.terminalRows() - FOOTER_ROWS);
    return new Promise((resolve) => {
      this.answer = resolve;
    });
  }

  private handleInput(input: string, key: Key, rows: number): void {
    const handlers = [
      () => this.handleTranscriptToggleKey(input, key),
      () => this.handleTranscriptKey(input, key, rows),
      () => this.handleGateKey(input, key),
      () => this.handleInterruptKey(input, key),
      () => this.handleToggleKey(input),
    ];
    handlers.some((handle) => handle());
  }
```

```tsx
  private handleGateKey(input: string, key: Key): boolean {
    if (this.answer === null) return false;
    const action = readGateKey(input, key);
    const handlers: GateActionHandlers = {
      move: (move) => {
        this.store.moveGateSelection(move.step);
      },
      answer: (answer) => {
        this.resolveGate(answer.choice);
      },
      submit: () => {
        this.resolveGate(this.selectedChoice());
      },
      none: () => undefined,
    };
    (handlers[action.kind] as (action: GateKeyAction) => void)(action);
    return action.kind !== "none";
  }
```

```tsx
  private selectedChoice(): ConfirmationChoice {
    const live = this.store.getSnapshot().live;
    const selected = live.kind === "gate" ? live.selected : 0;
    return CHOICE_ORDER[selected] ?? "n";
  }

  private resolveGate(choice: ConfirmationChoice): void {
    const answer = this.answer;
    this.answer = null;
    this.store.answerGate(choice);
    answer?.(choice);
  }
```

`src/view/run-store.ts:88-111`:

```ts
  openGate(prompt: GatePrompt, maxLiveRows: number): void {
    this.beginBlock("gate");
    const previewCommitted = pendingGateLines(prompt, 0, false).length > maxLiveRows;
    if (previewCommitted) this.commit(gateQuestionLines(prompt));
    this.update({ live: { kind: "gate", prompt, selected: 0, previewCommitted } });
  }

  moveGateSelection(step: number): void {
    const live = this.state.live;
    if (live.kind !== "gate") return;
    const selected = (live.selected + step + CHOICE_ORDER.length) % CHOICE_ORDER.length;
    this.update({ live: { ...live, selected } });
  }

  answerGate(choice: ConfirmationChoice): void {
    const live = this.state.live;
    if (live.kind !== "gate") return;
    this.update({ live: IDLE });
    this.finishBlock(
      { kind: "gate", prompt: live.prompt, choice, previewCommitted: live.previewCommitted },
      0,
    );
  }
```

`src/view/live-lines.ts:25-29` and `:49-54`:

```ts
export type Live =
  | { kind: "idle" }
  | { kind: "waiting"; since: number }
  | { kind: "stream"; stream: StreamKind; text: string; committedRows: number }
  | { kind: "gate"; prompt: GatePrompt; selected: number; previewCommitted: boolean };
```

```ts
const LIVE_RENDERERS: LiveRenderers = {
  idle: () => [],
  waiting: waitingLines,
  stream: liveStreamLines,
  gate: (live) => pendingGateLines(live.prompt, live.selected, live.previewCommitted),
};
```

`src/view/live-lines.ts:69-90` (`pendingGateLines` and `optionLine`):

```ts
export function pendingGateLines(
  prompt: GatePrompt,
  selected: number,
  previewCommitted: boolean,
): Line[] {
  const options = CHOICE_ORDER.map((choice, index) =>
    optionLine(choiceLabel(choice, prompt.toolName), index === selected),
  );
  return [
    ...(previewCommitted ? [] : gateQuestionLines(prompt)),
    gutterOnlyLine({ text: "│", color: "gray" }),
    ...options,
    gutterOnlyLine({ text: "└", color: "yellow" }),
  ];
}

function optionLine(label: string, selected: boolean): Line {
  const option: Span = selected
    ? { text: `● ${label}`, color: "cyan" }
    : { text: `○ ${label}`, color: "gray" };
  return { gutter: [RULE_GUTTER], body: [option] };
}
```

`src/view/block-lines.ts:41` (in the `Block` union) and `:161-170`:

```ts
  | { kind: "gate"; prompt: GatePrompt; choice: ConfirmationChoice; previewCommitted: boolean }
```

```ts
function gateLines(block: BlockOf<"gate">): Line[] {
  const answered: Line = {
    gutter: [{ text: "◇ ", color: block.choice === "n" ? "red" : "green" }],
    body: [
      { text: block.prompt.question },
      { text: " · ", color: "gray" },
      { text: choiceLabel(block.choice, block.prompt.toolName), color: "cyan" },
    ],
  };
  return block.previewCommitted ? [answered] : [answered, ...previewLines(block.prompt.preview)];
}
```

`src/view/ink/footer.tsx:23-36`:

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

function footerHints(state: RunViewState): Hint[] {
  if (state.transcript.open) return TRANSCRIPT_HINTS;
  return [...gateHints(state), ...toggleHints(state.toggles)];
}
```

`src/run/run-loop.ts:121-130`:

```ts
const preview = await buildPreview(options.target, call);
deps.view.confirmationStarted();
const choice = await deps.confirmer.confirm(call, preview);
const confirmed = recordConfirmation(gated.state, call, choice);
if (!confirmed.proceed)
  return {
    state: confirmed.state,
    outcome: { ok: false, output: "the user declined this tool call" },
  };
return runTool(confirmed.state, call, options);
```

`test/run/run-loop.test.ts:24-26`:

```ts
function scriptedConfirmer(choices: ConfirmationChoice[]): Confirmer {
  return { confirm: () => Promise.resolve(choices.shift() ?? "n") };
}
```

`test/live/ollama.live.test.ts:45`:

```ts
          confirmer: { confirm: () => Promise.resolve("y") },
```

### Conventions to match

- Pure, unit-tested functions for key mapping (`readGateKey` returning a tagged `{ kind }` union); `InkRunView` only routes. Follow `test/gate/confirmation-keys.test.ts` (its `NO_KEY` / `press` helpers) for new key tests.
- View state changes live in `RunStore` methods and are tested in `test/view/run-store.test.ts` through `getSnapshot()`.
- Typed renderer maps (`LIVE_RENDERERS`, `BLOCK_RENDERERS`): adding a union member makes `pnpm typecheck` demand a renderer — use that as your checklist.
- **No code comments of any kind**, including lint suppressions. A hook rejects them.
- Strict TS with `exactOptionalPropertyTypes`: model "no reason" as an empty string `""`, not an optional field.
- Glossary terms (from `GLOSSARY.md`): **Confirmation** (avoid "approval" or "permission prompt" in names), **Tool Call**, **Run**, **Model**.

## Commands you will need

| Purpose     | Command                                             | Expected on success |
| ----------- | --------------------------------------------------- | ------------------- |
| Typecheck   | `pnpm typecheck`                                    | exit 0              |
| Tests       | `pnpm test`                                         | all pass            |
| One file    | `pnpm vitest run test/gate`                         | all pass            |
| All gates   | `.claude/verify`                                    | exit 0              |
| Dead code   | `npx fallow --format json`                          | `total_issues: 0`   |
| Run by hand | `bin/harness.js "<task>"` inside a scratch git repo | interactive Run     |

## Scope

**In scope**:

- `src/gate/confirmer.ts`
- `src/gate/confirmation-keys.ts`
- `src/run/run-loop.ts`
- `src/view/ink-run-view.tsx`
- `src/view/run-store.ts`
- `src/view/live-lines.ts`
- `src/view/block-lines.ts`
- `src/view/ink/footer.tsx`
- `test/gate/confirmation-keys.test.ts`
- `test/run/run-loop.test.ts`
- `test/live/ollama.live.test.ts`
- `test/view/run-store.test.ts`
- `test/view/live-lines.test.ts`
- `test/view/block-lines.test.ts`
- `test/view/ink/run-app.test.tsx`

**Out of scope**:

- `src/run/run-state.ts` — a decline with a reason still counts as one failure toward the three-failure limit. Keep it that way.
- `src/prompt/system-prompt.ts` — its wording already covers this.
- Scoping the `a` choice. Plan 004 covers that; do not combine the two.
- The transcript, toggles and interrupt handling in `InkRunView` — leave their order and behaviour unchanged.

## Git workflow

- Branch: `advisor/003-decline-with-reason`.
- Conventional commit, e.g. `feat: send the decline reason back to the model`.
- Do not push or open a PR unless the operator told you to.

## Steps

### Step 1: Change the Confirmer contract and the loop (test first)

In `src/gate/confirmer.ts` add and use:

```ts
export interface ConfirmationAnswer {
  choice: ConfirmationChoice;
  reason: string;
}

export interface Confirmer {
  confirm(call: ToolCall, preview: string): Promise<ConfirmationAnswer>;
}
```

In `test/run/run-loop.test.ts`, change `scriptedConfirmer` to take `ConfirmationAnswer[]` with the fallback `{ choice: "n", reason: "" }`. Add a helper `const answer = (choice: ConfirmationChoice, reason = ""): ConfirmationAnswer => ({ choice, reason });` and update every caller, e.g. `scriptedConfirmer([answer("y")])`, `scriptedConfirmer([answer("n"), answer("n"), answer("n")])`.

Add a test `"sends the decline reason to the model"`: `new FakeBackend([[edit], [text("ok")]])` with the same `edit` Tool Call as the decline test, `scriptedConfirmer([answer("n", "use sed instead")])`, and assert `backend.requests[1]?.messages.at(-1)` equals `{ role: "tool", content: "the user declined this tool call: use sed instead", tool_name: "edit" }`. Keep `"feeds a decline back to the model and ends after three"` asserting the exact old string (empty reason → no colon).

In `test/live/ollama.live.test.ts` change the inline confirmer to `{ confirm: () => Promise.resolve({ choice: "y", reason: "" }) }`.

In `src/run/run-loop.ts` `resolveGate`: `const answer = await deps.confirmer.confirm(call, preview);`, pass `answer.choice` to `recordConfirmation`, and use a module-level function for the output:

```ts
function declineMessage(reason: string): string {
  return reason === ""
    ? "the user declined this tool call"
    : `the user declined this tool call: ${reason}`;
}
```

**Verify**: `pnpm vitest run test/run` → all pass. `pnpm typecheck` → errors only in `src/view/ink-run-view.tsx` (`confirm` return type). That is expected; Step 5 fixes it.

### Step 2: Key mapping for the reason field (test first)

In `src/gate/confirmation-keys.ts`:

1. Add `{ kind: "dismiss" }` to `GateKeyAction`. `readGateKey` returns it for Esc and Ctrl-C (instead of `answer n`). Dismiss means "decline with no reason, skip the field"; `n` and Enter-on-no open the field.
2. Add:

```ts
export type ReasonKeyAction =
  | { kind: "type"; text: string }
  | { kind: "erase" }
  | { kind: "submit" }
  | { kind: "skip" }
  | { kind: "none" };

export function readReasonKey(input: string, key: Key): ReasonKeyAction;
```

Rules, in this order: Esc or Ctrl-C → `skip`; Return → `submit`; `key.backspace || key.delete` → `erase` (many terminals send Backspace as `delete` in Ink); `key.ctrl || key.meta` → `none`; otherwise strip control characters with `input.replace(/\p{Cc}/gu, "")` and return `type` with that text, or `none` if it is empty. Multi-character `input` (paste) is typed as a whole.

In `test/gate/confirmation-keys.test.ts`: change `"counts escape and ctrl+c as no"` to expect `{ kind: "dismiss" }` (rename it `"dismisses on escape and ctrl+c"`), and add a `describe("readReasonKey")` with one `it` per rule, e.g. `readReasonKey("t", NO_KEY)` → `{ kind: "type", text: "t" }`, `readReasonKey("a\tb", NO_KEY)` → `{ kind: "type", text: "ab" }`, `readReasonKey("", press({ delete: true }))` → `{ kind: "erase" }`, `readReasonKey("u", press({ ctrl: true }))` → `{ kind: "none" }`.

**Verify**: `pnpm vitest run test/gate` → all pass.

### Step 3: Store state for the reason field (test first)

In `src/view/live-lines.ts` add a `Live` member:

```ts
  | { kind: "reason"; prompt: GatePrompt; previewCommitted: boolean; text: string }
```

and a renderer `reason: (live) => pendingReasonLines(live.prompt, live.text, live.previewCommitted)`. Export `pendingReasonLines` next to `pendingGateLines`; it returns the question lines (unless `previewCommitted`), the `│` spacer, one row `{ gutter: [RULE_GUTTER], body: [{ text: "why? ", color: "gray" }, { text: text }, { text: "▌", color: "cyan" }] }`, and the `└` line — same frame as `pendingGateLines`.

In `src/view/block-lines.ts` add `reason: string` to the `gate` Block member. In `gateLines`, when `block.reason !== ""` append `{ text: ": ", color: "gray" }, { text: block.reason }` after the choice label span.

In `src/view/run-store.ts`:

- `openReason(): void` — if live is `gate`, switch to `{ kind: "reason", prompt, previewCommitted, text: "" }`.
- `typeReason(text: string): void` and `eraseReason(): void` — append / drop the last character (`[...live.text].slice(0, -1).join("")`) when live is `reason`.
- `answerGate(choice: ConfirmationChoice, reason = ""): void` — accept live of kind `gate` **or** `reason`, and pass `reason` into the committed Block.

Tests (pattern: existing `describe("RunStore gates")` in `test/view/run-store.test.ts`):

- `"collects a decline reason and shows it on the answered gate"`: `openGate(shellPrompt, ROOMY)`, `openReason()`, `typeReason("use ")`, `typeReason("pwd")`, `eraseReason()`, assert `live` matches `{ kind: "reason", text: "use pw" }`, then `answerGate("n", "use pw")` and assert the last committed lines are `["◇ Allow shell: ls? · no: use pw", "│ $ ls"]`.
- In `test/view/live-lines.test.ts` add `"shows the reason field under the question"` asserting the full line list for `{ kind: "reason", prompt, previewCommitted: false, text: "abc" }`: `["◆ Allow shell: ls?", "│ $ ls", "│ ", "│ why? abc▌", "└ "]`.
- In `test/view/block-lines.test.ts` add `reason: ""` to the two existing gate fixtures, and add one with `choice: "n", reason: "no network"` → first line `"◇ Allow shell: ls? · no: no network"`.

**Verify**: `pnpm vitest run test/view` → all pass.

### Step 4: Footer hints

In `src/view/ink/footer.tsx` add `reasonHints(state)` returning `[["enter", "send"], ["esc", "skip"]]` while `state.live.kind === "reason"`, and include it in `footerHints` before the toggle hints. While the field is open, also leave out the toggle hints (typing `t` or `o` writes text, it does not toggle). Add a test in `test/view/ink/run-app.test.tsx` next to `"lists the gate keys before the toggles while a gate is open"`: after `openGate(...)` and `openReason()`, the footer text contains `"enter send   esc skip"` and does not contain `"thinking"`.

**Verify**: `pnpm vitest run test/view/ink` → all pass.

### Step 5: Wire it in `InkRunView`

In `src/view/ink-run-view.tsx`:

- `answer` becomes `((answer: ConfirmationAnswer) => void) | null`; `confirm` returns `Promise<ConfirmationAnswer>`.
- `handleGateKey`: if `this.answer === null` return false. If `store.getSnapshot().live.kind === "reason"`, delegate to a new `handleReasonKey(input, key)` and **return true for every key** (so `t`/`o` and plain letters never reach the toggle handler).
- Gate handlers: `answer` → if choice is `"n"` call `this.store.openReason()`, else `this.resolveGate(choice, "")`; `submit` → same rule using `this.selectedChoice()`; new `dismiss` → `this.resolveGate("n", "")`.
- `handleReasonKey` maps `readReasonKey` the same way `handleGateKey` maps `readGateKey` (a typed handler record): `type` → `store.typeReason(text)`; `erase` → `store.eraseReason()`; `submit` → `this.resolveGate("n", currentReasonText.trim())`; `skip` → `this.resolveGate("n", "")`; `none` → nothing.
- `resolveGate(choice, reason)` calls `this.store.answerGate(choice, reason)` and `answer?.({ choice, reason })`.

Keep `handleInput`'s handler order exactly as it is. Keep each method small; add a private `reasonText(): string` that reads `live.text` when live is `reason`, else `""`.

**Verify**: `pnpm typecheck` → exit 0. `.claude/verify` → exit 0. `npx fallow --format json` → `total_issues: 0`.

### Step 6: Full suite

**Verify**: `pnpm test` → all pass, and `grep -rn "Promise<ConfirmationChoice>" src` → no matches.

### Step 7: Check it by hand

In a real terminal:

```sh
d=$(mktemp -d) && cd "$d" && git init -q && echo hello > a.txt && git add . && git commit -qm init
/Users/jorden/src/local-agent-harness/bin/harness.js "replace hello with bye in a.txt"
```

At the first gate press `n`, type `use the edit tool, not shell` (check that `t` and `o` type letters rather than toggling), press Backspace once and retype the last letter, then Enter. Then run `tail -3 .harness/runs/*.jsonl`.

**Expected**: the scrollback shows `◇ Allow …? · no: use the edit tool, not shell`; the `tool` log entry has `"output":"the user declined this tool call: use the edit tool, not shell"`. Rerun and check: `n` then Enter alone logs the plain message; Esc on the gate declines straight away without opening the field; Esc inside the field declines with no reason; `y` and `a` behave as before.

## Test plan

- `test/run/run-loop.test.ts`: new test that the reason reaches the Model; existing tests moved to the `answer(...)` helper.
- `test/gate/confirmation-keys.test.ts`: `dismiss` on Esc/Ctrl-C; one test per `readReasonKey` rule.
- `test/view/run-store.test.ts`, `test/view/live-lines.test.ts`, `test/view/block-lines.test.ts`, `test/view/ink/run-app.test.tsx`: reason field state, rendering, answered block, footer.
- `InkRunView` stays covered by the Step 7 manual check only, as it is today.

## Done criteria

- [ ] `.claude/verify` exits 0
- [ ] `npx fallow --format json` reports `total_issues: 0`
- [ ] `grep -n "ConfirmationAnswer" src/gate/confirmer.ts src/view/ink-run-view.tsx test/run/run-loop.test.ts` matches in all three
- [ ] `grep -n "the user declined this tool call: " src/run/run-loop.ts` matches
- [ ] `grep -n "readReasonKey" src/gate/confirmation-keys.ts test/gate/confirmation-keys.test.ts` matches in both
- [ ] `git diff --stat d56080c -- src/run/run-state.ts` is empty
- [ ] `git status` shows only in-scope files changed
- [ ] Step 7 manual check passes
- [ ] `plans/README.md` row 003 updated

## STOP conditions

- The excerpts do not match the live files.
- Ink delivers typed characters to `useInput` with `key.ctrl` or `key.meta` set for ordinary letters, so typing produces nothing.
- In Step 7, typing in the field also toggles thinking/tool output, or the live region grows past the screen while typing a long reason.
- Any existing `run-loop` test other than the confirmer helper change needs editing to pass.

## Maintenance notes

- **Overlap with plan 004.** 004 changes the `a` choice (label in `choiceLabel`, footer hint, and possibly `CHOICE_ORDER` / `GateKeyAction`). Both plans edit `src/gate/confirmation-keys.ts`, `src/view/ink-run-view.tsx` and `src/view/ink/footer.tsx`. Run them one after the other, never in parallel worktrees; whichever lands second must re-run its drift check and merge by hand.
- If decline reasons turn out to be long, cap them in `typeReason`; today they go to the Model verbatim. A reason longer than the terminal width wraps; the live region budget assumes a few rows.
- Plan 010 (terminal-safe text) should also cover the reason text echoed into the answered gate line; `readReasonKey` already strips C0/C1 control characters on input.
- A reviewer should check that Ctrl-C inside the field ends as a decline and does not interrupt the Run (matching the gate's existing Ctrl-C behaviour).
