# Plan 010: Show control characters from the Model and files as visible escapes

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat d56080c..HEAD -- src/view/wrap-line.ts src/view/ink/line-view.tsx test/view/wrap-line.test.ts test/view/ink/run-app.test.tsx`
> If any in-scope file changed since this plan was written, compare every
> "Current state" excerpt below against the live file; on any mismatch, STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW (display only; nothing sent to the Model or written to the log changes)
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `d56080c`, 2026-10-19
- **Re-planned after 011**: the Ink port deleted every file the first version targeted; this version applies the fix at the one function every rendered `Line` passes through.

## Why this matters

The **Confirmation** gate is the user's main defence: they read a shell command or diff and press y or n. The command, the diff preview, the streamed reply and thinking, and tool output all come from the Model or from files, which prompt-injected repo content can steer.

Ink 8 already strips most terminal control sequences before writing (ESC-based CSI/OSC/DCS, CR, BEL, backspace, NUL, DEL, BiDi overrides and isolates). It does **not** handle the 8-bit C1 introducers: it treats U+009B (CSI) and U+0090…U+009C (DCS…ST) as the start of a sequence and silently swallows the printable characters after them. Measured on this commit through `LineView` + `renderToString`:

| Text the Model sent            | What the user sees     |
| ------------------------------ | ---------------------- |
| `$ cat notes \u009b>~/.bashrc` | `$ cat notes /.bashrc` |
| `$ ls \u0085x \u0090y\u009c z` | `$ ls x  z`            |
| `$ x\u0000y\u007fz`            | `$ xyz`                |

The first row is a command that truncates `~/.bashrc` while the gate shows a harmless `cat`. More broadly, everything Ink strips disappears without a trace, so the user cannot tell that the command they approve contains bytes they did not see.

After this plan, every Span's text is passed through one function, `toTerminalText`, that replaces each control character with a visible escape such as `\x9b` or `\u202e`. That happens inside `wrapLine`, which every rendered `Line` passes through, so widths are measured on the text the user actually sees.

## Current state

### How text reaches the screen

- `src/view/line.ts` — the `Span { text, color?, … }` and `Line { gutter: Span[]; body: Span[]; band? }` model. All Model and file text becomes `Span.text`, built in `src/view/block-lines.ts`, `src/view/run-store.ts`, `src/view/markdown-lines.ts` and `src/view/code-highlight.ts`.
- `src/view/wrap-line.ts` — `wrapLine(line, columns)` splits a `Line` into rows that fit the terminal. **This is the choke point.**
- `src/view/ink/line-view.tsx` — `LineView` calls `wrapLine` and renders each Span as an Ink `<Text>`. Used by `<Static>` in `src/view/ink/run-app.tsx:29` and by `Lines`, which `src/view/ink/live-region.tsx` and `src/view/ink/transcript.tsx` use.
- `src/view/ink/transcript.tsx:29` also calls `wrapLine` directly to count rows.
- `src/view/markdown-lines.ts:123` and `:202` call `wrapLine` for quotes and table cells; their output is wrapped again by `LineView`. `toTerminalText` must therefore be idempotent (it is: the escapes it writes contain only printable ASCII).
- The only other terminal writes are `src/cli.ts:55` (error message on stderr) and the alternate-screen codes in `src/view/ink-run-view.tsx:195,201`. Both are out of scope.

### Excerpts

`src/view/wrap-line.ts:1-27` (current):

```ts
import type { Line, Span } from "./line.js";

const graphemes = new Intl.Segmenter();

interface Piece {
  span: Span;
  text: string;
  space: boolean;
}

export function wrapLine(line: Line, columns: number): Line[] {
  const gutterWidth = textWidth(line.gutter.map((span) => span.text).join(""));
  const bodyWidth = Math.max(1, columns - gutterWidth);
  const rows = fillRows(pieces(line.body, bodyWidth), bodyWidth);
  const hanging: Span[] = [{ text: " ".repeat(gutterWidth) }];
  return rows.map((body, index) => ({
    ...line,
    gutter: index === 0 ? line.gutter : hanging,
    body,
  }));
}

function pieces(body: Span[], bodyWidth: number): Piece[] {
  return body.flatMap((span) =>
    (span.text.match(/\s+|\S+/g) ?? []).flatMap((text) => splitLong(span, text, bodyWidth)),
  );
}
```

`src/view/ink/line-view.tsx:19-25` and `:44-52`:

```tsx
function Spans({ spans }: { spans: Span[] }) {
  return spans.map((span, index) => (
    <Text key={index} {...spanProps(span)}>
      {span.text}
    </Text>
  ));
}
```

```tsx
export function LineView({ line, columns }: { line: Line; columns: number }) {
  return (
    <Box flexDirection="column">
      {wrapLine(line, columns).map((row, index) => (
        <Row key={index} row={row} />
      ))}
    </Box>
  );
}
```

### Conventions to match

- Small pure modules in `src/view/` with a test file each. Exemplar: `src/view/wrap-line.ts` and `test/view/wrap-line.test.ts`, which read results with `linesText` from `test/view/line-text.ts`.
- Ink component tests render with `renderToString` and strip colours with `stripVTControlCharacters`; see the `LineView` test at the top of `test/view/ink/run-app.test.tsx`.
- Constants at module top; named regexes.
- **No code comments of any kind**, including lint suppressions. A hook rejects them.

## Commands you will need

| Purpose   | Command                     | Expected on success             |
| --------- | --------------------------- | ------------------------------- |
| Typecheck | `pnpm typecheck`            | exit 0                          |
| Tests     | `pnpm vitest run test/view` | all pass                        |
| All gates | `.claude/verify`            | exit 0 (typecheck, lint, tests) |
| Dead code | `npx fallow --format json`  | `total_issues` is 0             |

## Scope

**In scope**:

- `src/view/terminal-text.ts` (create), `test/view/terminal-text.test.ts` (create)
- `src/view/wrap-line.ts`, `test/view/wrap-line.test.ts`
- `test/view/ink/run-app.test.tsx` (one new test only)

**Out of scope**:

- The run log and the messages sent to the Model. They keep raw bytes, because the Model and the log need the real content.
- `src/tools/tool-call.ts` (`describeToolCall`): sanitising is a display concern.
- `src/view/block-lines.ts`, `run-store.ts`, `markdown-lines.ts`, `code-highlight.ts`, `live-lines.ts`, `src/view/ink/*.tsx`: they must not change. Fixing it once in `wrapLine` covers them all.
- `src/cli.ts` error output and the alternate-screen escape codes in `ink-run-view.tsx`.
- Tab handling (see Maintenance notes).

## Git workflow

- Branch: `advisor/010-terminal-safe-text`.
- Conventional commit, e.g. `fix: show control characters from the model as visible escapes`.
- Do not push or open a PR unless the operator told you to.

## Steps

### Step 1: `toTerminalText` (test first)

Create `test/view/terminal-text.test.ts` with an `it.each` table over `toTerminalText(input)`:

| input (JS string literal) | expected                           |
| ------------------------- | ---------------------------------- |
| `"plain text"`            | `"plain text"`                     |
| `"a\nb\tc"`               | `"a\nb\tc"` (newline and tab kept) |
| `"\u001b[2K"`             | `"\\x1b[2K"`                       |
| `"ok\rrm"`                | `"ok\\x0drm"`                      |
| `"\u0000"`                | `"\\x00"`                          |
| `"\u0007"`                | `"\\x07"`                          |
| `"\u007f"`                | `"\\x7f"`                          |
| `"\u009b>~"`              | `"\\x9b>~"`                        |
| `"\u0090q\u009c"`         | `"\\x90q\\x9c"`                    |
| `"a\u202eb"`              | `"a\\u202eb"`                      |
| `"a\u2066b"`              | `"a\\u2066b"`                      |
| `"é ✓ 日本"`              | unchanged                          |

Add one more test: `toTerminalText(toTerminalText("\u009b"))` equals `toTerminalText("\u009b")` (idempotent).

Run it: `pnpm vitest run test/view/terminal-text.test.ts` → fails (module missing).

Create `src/view/terminal-text.ts`:

```ts
const UNSAFE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;

export function toTerminalText(text: string): string {
  return text.replace(UNSAFE, visibleEscape);
}
```

`visibleEscape(char)` returns `\x` plus two lower-case hex digits for code points below `0x100`, and `\u` plus four lower-case hex digits otherwise.

If eslint's `no-control-regex` rule fires on `UNSAFE`, build the regex with `new RegExp(...)` from a string of `\\u` escapes instead of adding a suppression, because comments and suppressions are not allowed.

**Verify**: `pnpm vitest run test/view/terminal-text.test.ts` → all pass. `pnpm lint` → exit 0.

### Step 2: Sanitise inside `wrapLine`

In `src/view/wrap-line.ts`, sanitise every Span of both `line.gutter` and `line.body` at the top of `wrapLine`, before any width is measured, and use the sanitised Spans everywhere below. Shape:

```ts
export function wrapLine(line: Line, columns: number): Line[] {
  const gutter = line.gutter.map(safeSpan);
  const gutterWidth = textWidth(gutter.map((span) => span.text).join(""));
  const bodyWidth = Math.max(1, columns - gutterWidth);
  const rows = fillRows(pieces(line.body.map(safeSpan), bodyWidth), bodyWidth);
  const hanging: Span[] = [{ text: " ".repeat(gutterWidth) }];
  return rows.map((body, index) => ({
    ...line,
    gutter: index === 0 ? gutter : hanging,
    body,
  }));
}

function safeSpan(span: Span): Span {
  return { ...span, text: toTerminalText(span.text) };
}
```

Note `mergeSpans` compares `row[index - 1]?.span === piece.span` by identity. That still works, because each `Piece` keeps a reference to the one sanitised Span it came from.

Add to `test/view/wrap-line.test.ts`:

- `linesText(wrapLine(reply("cat notes \u009b>~/.bashrc"), 40))` equals `["● cat notes \\x9b>~/.bashrc"]`;
- a gutter Span containing `\u001b` comes back as `\x1b` in row 0's gutter;
- a body of `"ab\u0007cd"` wrapped at width 5 counts the escape as 4 columns: `linesText(wrapLine({ gutter: [], body: [{ text: "ab\u0007cd" }] }, 5))` equals `["ab\\x0", "7cd"]`. If the long-word split lands differently, assert instead that every row's text is at most 5 characters long and that the joined rows equal `"ab\\x07cd"`.

**Verify**: `pnpm vitest run test/view` → all pass, including every pre-existing test.

### Step 3: Prove it end to end through Ink

In `test/view/ink/run-app.test.tsx`, inside the existing `describe("LineView", …)`, add:

```tsx
it("shows a C1 control introducer instead of letting it hide what follows", () => {
  const line: Line = { gutter: [], body: [{ text: "$ cat notes \u009b>~/.bashrc" }] };
  const output = renderToString(<LineView line={line} columns={60} />, { columns: 60 });
  expect(shown(output)).toEqual(["$ cat notes \\x9b>~/.bashrc"]);
});
```

Import `type Line` from `../../../src/view/line.js` alongside `REPLY_MARKER`. Without Step 2 this test shows `$ cat notes /.bashrc` (measured when this plan was written); with Step 2 it must pass.

**Verify**: `pnpm vitest run test/view/ink` → all pass.

### Step 4: Gates

**Verify**:

- `.claude/verify` → exit 0.
- `npx fallow --format json` → `total_issues` is 0.
- `grep -n "toTerminalText" src/view/wrap-line.ts` → at least one match.
- `grep -rn "toTerminalText" src | grep -v "src/view/terminal-text.ts\|src/view/wrap-line.ts"` → no matches (one choke point only).

## Test plan

- `test/view/terminal-text.test.ts`: 12 table rows plus the idempotence test.
- `test/view/wrap-line.test.ts`: 3 new tests (body, gutter, width).
- `test/view/ink/run-app.test.tsx`: 1 new end-to-end `LineView` test.
- `pnpm test` → all pass.

## Done criteria

- [ ] `.claude/verify` exits 0
- [ ] `npx fallow --format json` reports `total_issues: 0`
- [ ] Step 4 greps give the expected results
- [ ] `git diff --stat d56080c -- src/tools src/run src/log src/backend src/gate` is empty
- [ ] `git status` shows only in-scope files changed
- [ ] `plans/README.md` row 010 updated

## STOP conditions

- The excerpts do not match the live files.
- A pre-existing view or Ink test fails because it expected a raw control character, or because a row now wraps differently. Report it; do not weaken the sanitiser.
- The new `LineView` test still shows `/.bashrc` after Step 2. That would mean some rendered text bypasses `wrapLine`; report where instead of adding a second call site.
- Sanitising changes Static output ordering or the live-region row count in `test/view/ink/*` tests.

## Maintenance notes

- Rule: every rendered `Line` passes through `wrapLine`. New view code that renders `Span.text` without `LineView`/`Lines`/`wrapLine` must call `toTerminalText` itself; reviewers should check any new `<Text>` that shows non-literal text.
- `markdown-lines.ts` measures table cells with `textWidth` before `wrapLine` sanitises them, so a table cell containing control characters may misalign by a few columns. Cosmetic only; fix by sanitising in `markdownLines` if it ever matters.
- Tabs are kept, as before. Ink expands them while `textWidth` counts one column, so tab-heavy text can overflow a row. That is a layout bug, not a security one; fix it by expanding tabs in `wrapLine` with its own test.
- Ink 8 strips ESC-based sequences itself; this plan does not rely on that. If Ink is upgraded, the end-to-end test in `run-app.test.tsx` keeps guarding the C1 case.
- The log keeps raw bytes on purpose. A future `--replay` (plan 005) must render through the same `LineView` so replayed logs get the same protection.
- `src/cli.ts:55` prints error messages, which can include Backend text, straight to stderr. Low risk; fold it in only if a later audit finds Model-controlled text reaching it.
