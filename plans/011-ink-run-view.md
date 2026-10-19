# Plan 011: Port the RunView to Ink 8, with thinking and tool-output toggles and a transcript screen

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 80f37cf..HEAD -- src/view src/gate src/cli.ts src/run/run-loop.ts test/view test/gate`
> If any in-scope file changed since this plan was written, compare the
> "Current state" list below against the live tree; on any mismatch, STOP.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MEDIUM (replaces every terminal-writing module; the run loop, tools and log are untouched)
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `80f37cf`, 2026-10-19

## Why this matters

The user wants to toggle thinking and tool output while a Run is going, and to look back over the whole Run expanded. The hand-rolled view writes raw ANSI to stdout, which can't keep a live footer or redraw a region. It also can't hang wrapped text at column 2.

The spike on branch `spike/ink-run-view` (`prototypes/ink-run-view-spike/FINDINGS.md`, commit `2fa7d17`) measured Ink 8. It found no tearing, because Ink wraps each frame in synchronized output. It found clean scrollback as long as the live region stays shorter than the terminal. It found that the `<Static>` plus transcript-screen pattern works.

This plan ports that design into `src/`. It keeps the look of the design canvas: colours, glyphs, the column-0/2/4 layout, and one blank line between blocks.

This does not reverse the "full-screen TUI" rejection in `plans/README.md`. The Run still prints inline into normal scrollback. Only the opt-in transcript (`ctrl+o`) uses the alternate screen.

## Current state

### Files and roles (all replaced or deleted by this plan unless noted)

- `src/view/run-view.ts`: the `RunView` interface the run loop calls. **Kept unchanged.**
- `src/gate/confirmer.ts`: the `Confirmer` interface. **Kept unchanged.**
- `src/run/run-loop.ts`: calls `RunView` and `Confirmer`. **Not edited.**
- `src/view/terminal-run-view.ts`: block spacing, streaming and spinner, as ANSI writes.
- `src/view/spinner.ts`, `src/view/stream-indent.ts`, `src/view/tool-line.ts`, `src/view/preview-render.ts`, `src/view/run-frame.ts`, `src/view/terminal-rows.ts`: string formatters.
- `src/gate/terminal-confirmer.ts`, `src/gate/confirmation-frame.ts`: the raw-mode keypress prompt and its frames.
- `src/gate/confirmation-keys.ts`: a pure key reducer. **Kept and adapted** to Ink's key shape.
- `src/cli.ts`: writes the header, runs the task, writes the summary.

### Conventions to match

- Small pure modules with one test file each. `stripVTControlCharacters` is used in tests.
- **No code comments of any kind**, including lint suppressions. A hook rejects them.
- Fallow must report no findings, complexity included. Prefer lookup tables over long `if` and `switch` chains, as the spike's second pass did.
- Use `pnpm`, never `npm`.

## Target design

Both the live view and the transcript render rows through one line model:

- `Line = { gutter: Span[]; body: Span[]; band?: boolean }`. The gutter is a box with `flexShrink 0`, and the body wraps inside its own box. Wrapped text therefore hangs at the text column.
- `SPACING = { textColumn: 2, toolTextColumn: 4, blankLinesBetweenBlocks: 1, footerGap: 1, ruleWidth: 60, toolOutputCap: 8, previewCap: 80 }`.
- `blankLinesBefore(previous, next)` returns 0 before the first block. It returns 0 for a tool line after a reply, tool or gate. Otherwise it returns 1.
- A blank row holds `" "`, because an empty `<Text>` takes zero rows in Ink.

The screen has three parts:

1. **`<Static>`:** every finished row, in order, printed once into scrollback.
2. **Live region:** the current partial stream row, the spinner, or a pending gate. Every finished stream row moves into `<Static>` straight away. A gate whose rows plus the footer would not fit in `stdout.rows` first commits its question and preview, and keeps only the options live.
3. **Footer:** key hints for `t`, `o` and `ctrl+o`, plus `y`, `n`, `a` and `esc` during a gate. It renders only when stdin and stdout are TTYs.

Toggles change the rows rendered after the keypress. The transcript (`ctrl+o`) re-renders every block from the store with everything expanded. It uses `instance.clear()` and `ESC[?1049h`/`l`, and holds rows committed while it is open until it closes.

Keys:

- `ctrl+c` outside a gate unmounts Ink, leaves the alternate screen and exits with 130. At a gate it counts as "n", as before.
- `esc` at a gate counts as "n".

## Commands you will need

| Purpose   | Command                    | Expected on success |
| --------- | -------------------------- | ------------------- |
| Typecheck | `pnpm typecheck`           | exit 0              |
| Tests     | `pnpm vitest run`          | all pass            |
| All gates | `.claude/verify`           | exit 0              |
| Dead code | `npx fallow --format json` | 0 issues            |

## Scope

**In scope**: everything under `src/view/` and `src/gate/` except `run-view.ts` and `confirmer.ts`; `src/cli.ts`; `tsconfig.json` (JSX); `package.json` (ink, react, @types/react); the matching tests; `GLOSSARY.md` (only if a new term is needed, which is not expected).

**Out of scope**: the run loop, tools, backend and log. Also config-file defaults for the toggles; keys are enough for now. Plan 010's sanitising is out of scope too, but read the maintenance note.

## Git workflow

- Work on `main`, as the operator asked: "write the plan, then execute it".
- Use conventional commits, one per step group. Push when done.

## Steps

### Step 1: Dependencies and JSX

Add `ink@8.0.0`, `react@19.3.1` and `@types/react` with pnpm. Set `"jsx": "react-jsx"` in `tsconfig.json`.

**Verify**: `pnpm typecheck` passes. A throwaway `renderToString(<Text>hi</Text>)` in a test returns `hi`; delete that test afterwards.

### Step 2: Line model (test first)

Create `src/view/line.ts` with `Span`, `Line`, `SPACING`, `BLANK`, the markers, `markedLines`, `blankLinesBefore` and `gutterOnlyLine`.

**Verify**: `test/view/line.test.ts` covers the blank-line rule table and the hanging gutters in `markedLines`.

### Step 3: Block rows (test first)

Create `src/view/block-lines.ts` with the `Block` union (header, task, thinking, reply, tool, gate, summary) and `blockLines(block, toggles)` as a renderer table. Port from the old formatters:

- the tool detail (`· N lines`, `→ first line`, silent write and edit)
- the preview colouring and file-header dropping, with the 80-line cap applied by the caller as before
- the header, with `thinking on`
- the summary marker (`✓` or `!`) and `formatDuration`

Add the tool-output rows: a ` │` gutter, a cap of 8 rows, and `… N more lines`.

**Verify**: port the assertions from `tool-line`, `preview-render` and `run-frame` tests to this module and remove the old ones.

### Step 4: Run store (test first)

Create `src/view/run-store.ts`, a pure class with `subscribe` and `getSnapshot` for `useSyncExternalStore`. Its actions:

- `addBlock`
- `startWaiting`
- `streamText(kind, text)`, which drops leading blank lines before the first row, commits finished rows and keeps the partial row live
- `endReply`
- `openGate(prompt, rows)`, which applies the tall-gate split
- `moveGateSelection`, `answerGate`
- `toggle`
- `openTranscript`, `closeTranscript`, `scrollTranscript`

It holds the committed rows (keyed and append-only), the blocks, the live state, the toggles, the transcript position and the held rows.

**Verify**: tests cover:

- block spacing (the ported `terminal-run-view` cases)
- the hanging indent of streamed rows
- thinking hidden, which leaves a `∴ thinking · N chars hidden` row
- a tall gate committing its preview first
- rows held while the transcript is open, then flushed on close

### Step 5: Gate keys

Adapt `src/gate/confirmation-keys.ts` to Ink's `(input, key)` shape and keep its tests' meaning: y, n and a answer; escape and ctrl+c count as no; the arrows wrap; enter picks the selected option.

**Verify**: `pnpm vitest run test/gate` passes.

### Step 6: Ink components

Create `src/view/ink/` with `line-view.tsx`, `live-region.tsx` (the spinner frame on its own 80 ms timer, only while waiting), `footer.tsx`, `transcript.tsx` and `run-app.tsx`.

**Verify**: `renderToString` tests show three things:

- a wrapped reply row hangs at column 2 at `columns: 40`
- the footer shows the gate hints during a gate
- the transcript shows tool output even when the toggle is off

### Step 7: `InkRunView` and CLI wiring

Create `src/view/ink-run-view.tsx`, implementing `RunView` and `Confirmer` on top of the store and `render()`:

- `exitOnCtrlC: false`
- input handled only when stdin is a TTY
- `confirm()` throws the existing "rerun with --yolo" error when stdin is not a TTY
- `start(header)` and `finish(result, elapsedMs)` unmount, then await `waitUntilExit()`

Rewire `cli.ts` to use it, and make sure the error path unmounts before writing to stderr. Delete the old modules and their tests.

**Verify**: `.claude/verify` exits 0 and Fallow finds 0 issues.

### Step 8: Live checks

Use a scratch git repository and a local Ollama model, with `--think`:

1. **Interactive run in a cmux pane.** Toggle `t` and `o` mid-run; open `ctrl+o`, scroll and close; answer one gate with the arrows and enter, and one with `esc`; press `ctrl+c` at the end of a second run. Check that scrollback has no duplicated rows and that the terminal is restored.
2. **Piped run**: `harness --yolo … | cat`. The full Run must print, with no footer and no cursor codes beyond colours.

## Test plan

The pure modules (`line`, `block-lines`, `run-store`, `confirmation-keys`) carry the behaviour tests. The Ink components get `renderToString` snapshot-style assertions on stripped text. The run loop's existing tests stay as they are, because the `RunView` contract does not change.

## Done criteria

- [ ] `.claude/verify` exits 0, and Fallow reports 0 issues
- [ ] the old modules from "Current state" are deleted, except the three marked kept
- [ ] `git diff --stat 80f37cf -- src/run src/tools src/backend src/log` is empty
- [ ] both live checks in Step 8 pass
- [ ] `plans/README.md` row 011 is updated

## STOP conditions

- The piped run prints nothing, or only the last frame. Ink's non-interactive mode would then need a plain fallback renderer; report that rather than bolting one on.
- Ink cannot read keys while the run loop awaits the Backend. That would mean an event-loop or raw-mode clash.
- Any `run-loop` test needs editing.

## Maintenance notes

- **Plan 010 must be re-planned after this one.** Its target files are deleted here. Every piece of Model or file text now enters the screen as a `Span.text` built in `block-lines.ts` or `run-store.ts`, so `toTerminalText` belongs there.
- The live region must stay shorter than the terminal; the spike measured about 750 duplicated rows in scrollback when it was not. Any new live content needs a row budget.
- A single unbroken line longer than `rows × columns` characters can still grow the live region past the screen. It has not been seen with Qwen output; if it happens, commit wrapped rows by width.
- The shifted rows seen in the spike's cmux scrollback were traced to the terminal, not Ink. Recheck in iTerm2 or Ghostty if they appear.
