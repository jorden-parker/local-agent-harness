# Agent TUI patterns: research notes

Date of research: 2026-10-19. Target: one-shot `harness "task"` CLI, Node 22, ESM, TypeScript strict, pnpm, raw fetch to Ollama.

Companion to `docs/research/tui-libraries.md`, which covers Ink, OpenTUI, blessed, clack, Inquirer, readline and picocolors/diff. This file does not repeat that comparison. It covers how the agent CLIs lay out their screens and gate tool calls, and which reusable components exist.

Source method: shallow clones of each repo (`--depth 1`, default branch, cloned 2026-10-19), read by grep. Public URLs are given per claim. Commit SHAs were not pinned, so re-check line numbers before quoting them.

## Part 1: Open-source agent CLIs

### Summary matrix

| Harness      | Language / UI stack                                                | Layout model                                                     | Approval UI                                                                    | Tool output                                      |
| ------------ | ------------------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------ |
| Gemini CLI   | TS, Ink fork (`@jrichman/ink` 6.6.9) on React 19.2.4               | Ink tree, optional alternate buffer                              | Radio list: Allow once / Allow for session / Allow and save / Modify in editor | `MaxSizedBox`, "press ctrl+o to show more lines" |
| Codex CLI    | Rust, ratatui + crossterm                                          | Bottom pane over a history of cells, optional alt screen         | Overlay with keyed options; "don't ask again" scoped by prefix                 | Pager overlay for full transcript                |
| OpenCode     | TS, `@opentui/core` + `@opentui/solid` (Solid reconciler)          | Session route with grouped message parts; "mini" scrollback mode | Permission route: once / always / reject, plus reject-with-message stage       | `PatchDiff` component; per-part expand state     |
| Pi (pi-mono) | TS, own TUI package `@earendil-works/pi-tui`                       | Differential renderer, main-screen or alt-screen                 | Not found in README (see notes)                                                | Truncation at 2000 lines / 50 KB                 |
| Crush        | Go, Bubble Tea v2, Bubbles v2, Lip Gloss v2, Glamour v2, Chroma v2 | Chat list with viewport, dialogs as overlays                     | Dialog: a allow / s allow session / d deny                                     | Assistant messages collapse, tail-window, full   |
| Goose CLI    | Rust, `cliclack` prompts + `rustyline` input                       | Line-oriented session, prompts inline                            | cliclack select: Allow / Always Allow / Deny / Cancel                          | Not verified                                     |
| Aider        | Python, `prompt_toolkit` input + `rich` output                     | Line-oriented, streamed to terminal                              | `confirm_ask` with `(Y)es/(N)o/(A)ll/(S)kip all`                               | Not verified                                     |
| Claude Code  | Closed source; public docs only                                    | Not visible                                                      | Per-tool prompt; "Yes, and don't ask again" scoped per repo/command            | Not verified (`--verbose` shows parameters)      |

### Gemini CLI (google-gemini/gemini-cli, TypeScript, pushed 2026-10-19, about 107k stars)

- **Renderer.** Ink via a fork: `"ink": "npm:@jrichman/ink@6.6.9"`, with `"react": "19.2.4"`. Source: https://github.com/google-gemini/gemini-cli/blob/main/packages/cli/package.json
- **Layout.** A `useAlternateBuffer` hook reads a config flag (`config.getUseAlternateBuffer() || config.getUseTerminalBuffer()`), so the screen can run in the alternate buffer or the main buffer. Source: https://github.com/google-gemini/gemini-cli/blob/main/packages/cli/src/ui/hooks/useAlternateBuffer.ts. The screen has `Composer.tsx`, `MainContent.tsx`, `Footer.tsx`, and `ToolConfirmationQueue.tsx` under `packages/cli/src/ui/components/`.
- **Streaming.** `useGeminiStream.ts` keeps a `pendingHistoryItem` (state and ref) and a list of pending tool-call requests. The pending item is committed to history when it completes. Source: https://github.com/google-gemini/gemini-cli/blob/main/packages/cli/src/ui/hooks/useGeminiStream.ts. I did not verify a flush interval.
- **Markdown.** `packages/cli/src/ui/utils/MarkdownDisplay.tsx` renders markdown to Ink `<Text>`/`<Box>`. It calls `colorizeCode` (`CodeColorizer.tsx`, `highlight.ts`) for fenced code and a `TableRenderer`. Source: https://github.com/google-gemini/gemini-cli/tree/main/packages/cli/src/ui/utils
- **Approval.** `packages/cli/src/ui/components/messages/ToolConfirmationMessage.tsx` builds the option list:
  - `Allow once` → `ToolConfirmationOutcome.ProceedOnce` (line ~292)
  - `Allow for this session` → `ProceedAlways` (~298)
  - an "allow and save" variant → `ProceedAlwaysAndSave` (~305)
  - `Modify with external editor` (~314), hidden in IDE mode
  - Edits show a `DiffRenderer` (line ~697) and the command body sits in a `MaxSizedBox` (line ~848).
  - Source: https://github.com/google-gemini/gemini-cli/blob/main/packages/cli/src/ui/components/messages/ToolConfirmationMessage.tsx
- **Output truncation.** `ToolMessage.tsx` (line ~150) and `ShellToolMessage.tsx` (`calculateShellMaxLines`, line ~85) pass `maxLines` into `MaxSizedBox`. The hint text is in `ShowMoreLines.test.tsx`: "press ctrl+o to show more lines". Source: https://github.com/google-gemini/gemini-cli/blob/main/packages/cli/src/ui/components/ShowMoreLines.tsx
- **Small models.** `packages/core/src/tools/definitions/modelFamilyService.ts` `getToolFamily(modelId)` returns `'gemini-3'` for Gemini 3 models and `'default-legacy'` for everything else. The two tool manifests live in `model-family-sets/gemini-3.ts` and `default-legacy.ts`. The legacy set is described as the "full tool manifest for legacy models" with full schemas. Source: https://github.com/google-gemini/gemini-cli/tree/main/packages/core/src/tools/definitions
- **Borrowable.** Option list built from data, with the outcome enum separate from the label. Tool sets chosen per model family.

### Codex CLI (openai/codex, Rust, pushed 2026-10-19, about 130k stars)

- **Renderer.** `codex-rs/tui/Cargo.toml` depends on `ratatui` and `crossterm` (bracketed paste, event-stream). Source: https://github.com/openai/codex/blob/main/codex-rs/tui/Cargo.toml
- **Layout.** `lib.rs` picks alt-screen mode per run through an `AltScreenMode` setting (`AltScreenMode::Always` at line ~2277). The bottom pane lives in `tui/src/bottom_pane/`, and history is built from `history_cell/` modules. Pager overlays are in `pager_overlay.rs`. Source: https://github.com/openai/codex/tree/main/codex-rs/tui/src
- **Streaming.** Two layers, both documented in module headers:
  - `markdown_stream.rs`: `MarkdownStreamCollector` buffers token deltas and only commits complete lines at newlines. The trailing partial line stays buffered.
  - `streaming/chunking.rs`: an adaptive policy switches between `Smooth` (one queued line per commit tick) and `CatchUp` (drain the backlog) based on queue depth and age.
  - Source: https://github.com/openai/codex/blob/main/codex-rs/tui/src/markdown_stream.rs and https://github.com/openai/codex/blob/main/codex-rs/tui/src/streaming/chunking.rs
- **Markdown and code.** `pulldown-cmark` for parsing; `syntect` + `two-face` for highlighting (`codex-rs/tui/Cargo.toml` lines 91 and 128–129). Also `diff_render.rs` and `diff_model.rs` for patches.
- **Approval.** `tui/src/bottom_pane/approval_overlay.rs` `build_options`: the first option is `Yes, proceed` (line ~865). Scoped variants include `Yes, and don't ask again for commands that start with \`<prefix>\``, `...for this command in this session`, and `Yes, and allow this host ...`for network. Esc cancels, and Ctrl-C is handled in`on_ctrl_c`. Source: https://github.com/openai/codex/blob/main/codex-rs/tui/src/bottom_pane/approval_overlay.rs
- **Borrowable.** The idea of scoped "don't ask again": a prefix for commands, a host for network, and a session flag for everything else. The stream chunking policy is also small and reusable in principle.
- **Not verified:** Codex's small-model handling. I did not read the model-family code.

### OpenCode (sst/opencode, pushed 2026-10-19, about 217k stars)

- **Renderer.** The TUI package is `packages/tui` (`"name": "@opencode/tui"`), with `@opentui/core`, `@opentui/keymap`, `@opentui/solid` and `opentui-spinner` (catalog versions). Source: https://github.com/sst/opencode/blob/dev/packages/tui/package.json. The repo default branch may differ from `dev`; the path is what I read.
- **Layout.** `packages/tui/src/routes/session/` holds `index.tsx`, `message-parts.tsx`, `group-view.tsx`, `permission.tsx`, `dialog-execute.tsx`, `sidebar.tsx`. There is also a `mini/` mode with `scrollback.writer.tsx`, which appends to terminal scrollback. Source: https://github.com/sst/opencode/tree/dev/packages/tui/src/routes/session
- **Streaming and markdown.** `MarkdownRenderable` is imported in `mini/scrollback.writer.tsx`. Markdown in the session view is rendered through OpenTUI's `<markdown>` and `<code filetype=...>` elements (`group-view.tsx` line ~387, `dialog-execute.tsx` line ~266).
- **Permission.** `routes/session/permission.tsx`: options are `once`, `always`, `reject` for an edit or shell action. Choosing `reject` moves to a second stage (`PermissionStage = "permission" | "reject"`, line 20) where you can add a message to the rejection. Escape maps to reject. Source: https://github.com/sst/opencode/blob/dev/packages/tui/src/routes/session/permission.tsx
- **Diffs.** `routes/session/index.tsx` imports `PatchDiff` from `component/patch-diff`, and `config.diffs.wrap` controls word wrap (default `"word"`).
- **Truncation.** `message-parts.tsx` keeps a per-part `expanded` signal (line 53) and a `inMinimal()` mode that drops the left border and padding.
- **Borrowable.** Permission as a route with a two-stage reject. Per-part expand state. A mini mode that writes to scrollback instead of owning the screen.

### Pi coding agent (badlogic/pi-mono, TypeScript, pushed 2026-10-19, about 116k stars)

- **Renderer.** Own package `packages/tui`. Published as `@earendil-works/pi-tui` at version 1.3.0 (2026-10-15). The older npm name `@mariozechner/pi-tui` stops at 0.73.1 (2026-05-07). Dependencies: `get-east-asian-width` and `marked` 18.0.11. Source: https://github.com/badlogic/pi-mono/blob/main/packages/tui/package.json and https://www.npmjs.com/package/@earendil-works/pi-tui
- **Rendering.** Differential rendering: updates only changed lines or viewport rows. Output is wrapped in CSI 2026 synchronized output (`tui-main-screen.ts` lines ~281 and ~303). Two renderers share a `TUI` interface: `TuiMainScreen` (main buffer) and an alt-screen one (`tui-alt-screen.ts`). Source: https://github.com/badlogic/pi-mono/blob/main/packages/tui/README.md
- **Components.** Text, TruncatedText, Input, Editor, Markdown, Loader, SelectList, SettingsList, MouseRegion, Spacer, Image (Kitty/iTerm2), Box, Container, VStack, HStack, ScrollView. Autocomplete for paths and slash commands. Bracketed paste with markers for pastes over 10 lines.
- **Permissions.** `packages/coding-agent/README.md` says Pi "skips features like sub-agents and plan mode." I did not find a permission prompt in the README or the modes (`interactive`, `print-mode`, `json-event`, `rpc`). Treat Pi as having no per-tool gate unless verified further. Source: https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md
- **Truncation.** `packages/coding-agent/src/core/tools/truncate.ts`: `DEFAULT_MAX_LINES = 2000`, `DEFAULT_MAX_BYTES = 50 * 1024`. The bash tool uses these limits.
- **Borrowable.** The differential renderer and the synchronized-output wrapping are the most reusable parts in this list. Depends on the same CSI 2026 sequence that Codex and others use.

### Crush (charmbracelet/crush, Go, pushed 2026-10-19, about 28.7k stars)

- **Stack.** `go.mod`: `charm.land/bubbletea/v2` v2.1.0, `charm.land/bubbles/v2` v2.2.1, `charm.land/lipgloss/v2` v2.0.6, `charm.land/glamour/v2` v2.0.1 (markdown), `github.com/alecthomas/chroma/v2` v2.27.0 (highlighting). Source: https://github.com/charmbracelet/crush/blob/main/go.mod
- **Permission.** `internal/ui/dialog/permissions.go`: `a` / `A` / `ctrl+a` allow, `s` / `S` / `ctrl+s` allow session, `d` / `D` deny (lines ~118–130). Actions are the constants `PermissionAllowForSession = "allow_session"` and `PermissionDeny = "deny"` (lines 30–31). The dialog also has a viewport and a diff view state (lines 66–72).
- **Assistant message truncation.** `internal/ui/chat/assistant.go` lines 20–22 and 56: a collapsed → tail-window → full-expanded cycle, with the hint `"… (%d lines hidden) [click or space to expand]"`.
- **Diff.** `internal/ui/diffview/` and `internal/ui/common/diff.go`. Split and unified modes (`defaultDiffSplitMode` chosen by width).
- **Borrowable.** One-key permission choices with the same keys in upper and lower case. Assistant message in three states. Width-based split vs unified diff.

### Goose CLI (block/goose, Rust, pushed 2026-10-19, about 55k stars)

- **Stack.** `crates/goose-cli/Cargo.toml`: `cliclack` 0.5 (prompts), `rustyline` 18 (line input with history), `bat` 0.26 (highlighting). Source: https://github.com/block/goose/blob/main/crates/goose-cli/Cargo.toml
- **Permission.** `crates/goose-cli/src/session/mod.rs` ~line 2279 and ~2292: select items `Allow` ("Allow the tool call once"), `Always Allow`, `Deny` ("Deny the tool call"), and `Cancel`. The select is a cliclack item list. Source: https://github.com/block/goose/blob/main/crates/goose-cli/src/session/mod.rs
- **Not verified:** how tool output is truncated and whether the CLI renders markdown. The desktop app under `ui/` is a separate UI and was not read.
- **Borrowable.** A cliclack select is the same shape as the y/n/a gate, with a "cancel" option added.

### Aider (Aider-AI/aider, Python, pushed 2026-05-22, about 49.6k stars)

- **Stack.** `prompt_toolkit` (`aider/io.py` line 25: `PromptSession`) for input, `rich` 14.3.3 for output, `pygments` for highlighting. Source: https://github.com/Aider-AI/aider/blob/main/aider/io.py
- **Confirm prompt.** `io.py` `confirm_ask` (line ~807) builds options `(Y)es/(N)o`, adds `/(A)ll` when allowed, and `/(S)kip all` (lines ~832–836). Valid responses are `yes`, `no`, `skip`, `all`. Line-based input, not single-key.
- **Diffs.** Aider shows edits as a diff in the terminal and asks to apply. I did not verify the exact preview code path.
- **Small-model handling (strongest signal in this set).** `aider/resources/model-settings.yml` has 471 `edit_format` lines. Each model gets its own format: `udiff` (line 22), `diff` (line 36), plus `editor-diff` for architect mode. It also sets `weak_model_name` (for example `gpt-4o-mini`, line 2) for cheaper side tasks such as commit messages. Source: https://github.com/Aider-AI/aider/blob/main/aider/resources/model-settings.yml
- **Edit format docs.** https://aider.chat/docs/more/edit-formats.html: `whole` returns the full file (simple but slow and costly); `diff` returns search/replace blocks; `udiff` is a simplified unified diff, used mainly with the GPT-4 Turbo family to reduce "lazy coding"; `diff-fenced` is used with Gemini models. Format names and recommendations change between Aider releases, so check the current page before relying on them.

### Claude Code (public docs only)

- **Permission model.** Docs: https://code.claude.com/docs/en/permissions. Read-only tools need no approval inside the working directory. Bash, file edits, WebFetch and WebSearch prompt by default.
- **Prompt options.** A prompt offers "Yes", "Yes, and don't ask again" (saved per repo and command, or per domain, or per session for file edits), and "No". A third option, "Yes, and switch to auto mode", appears on some prompts. One-time-only prompts appear when the action cannot be safely scoped.
- **Rules.** Stored in `.claude/settings.local.json` at the git root. Patterns such as `Bash(git * main)` match subcommands and options. The docs warn that `*` can match a `-c` option that runs a program, so patterns need care.
- **Notes.** Pressing Tab on an option opens a comment field that goes with the answer. Deny rules that name a bare tool remove the tool from the model's context.
- **Not visible:** rendering library, transcript layout, and truncation behaviour. Do not claim them.

### Cross-harness patterns

1. **Gate is a list with a stable key per option.** Gemini uses an ordered list; Crush uses letters `a`, `s`, `d`; Codex and Claude Code use "yes / yes-and-scope / no". Keep "yes once", "yes for session" and "no" at minimum.
2. **Scope for "don't ask again" differs by tool.** Commands get a prefix or pattern, network gets a host, edits get "until session end". Codex and Claude Code both scope this way.
3. **Tool output is capped and expandable.** Common caps: Pi 2000 lines / 50 KB; Gemini `maxLines` with a Ctrl-O hint; Crush three-state collapse. A one-shot CLI can cap diffs and tool output with one `expand` affordance.
4. **Streaming commits at line boundaries.** Codex buffers until newline; the others re-render. For a plain stdout stream this matches what `process.stdout.write` gives you.
5. **Two renderer families.** Full-screen (Codex, Crush, Gemini alt buffer, OpenCode, Pi alt-screen) and inline or scrollback (Goose, Aider, OpenCode mini, Pi main-screen). The one-shot harness fits the inline family.
6. **Small models get fewer tools and simpler edit formats.** Gemini picks a tool manifest per model family; Aider picks an edit format per model. Expect the harness to need the same split.

## Part 2: Reusable components and building blocks (TS ecosystem)

Versions and dates from `npm view` on 2026-10-19. "Maint" is the npm `time.modified` date unless noted.

| Package                             | Version (date)       | What it gives                                                                      | Cost                                                                | Verdict                                                                                     |
| ----------------------------------- | -------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `@earendil-works/pi-tui`            | 1.3.0 (2026-10-15)   | Differential renderer, Markdown, Editor, SelectList, Loader, ScrollView, Box/Stack | Dep: `marked` 18.0.11, `get-east-asian-width`. Engines not checked. | Strongest candidate for an inline renderer and gate. Check Node 22 support before adopting. |
| `@mariozechner/pi-tui`              | 0.73.1 (2026-05-07)  | Older name of the same package                                                     | Same                                                                | Do not use; superseded by the scoped name.                                                  |
| `@opentui/core` / `react` / `solid` | 0.6.6 (2026-10-14)   | Full-screen renderer; React and Solid reconcilers                                  | Node `>=26.4`, Bun `>=1.3.14`                                       | Excluded by Node 22. See sibling doc.                                                       |
| `ink`                               | 8.0.0 (2026-10-03)   | React reconciler for terminals                                                     | 23 direct deps, React 19.3+                                         | Sibling doc has the comparison.                                                             |
| `@inkjs/ui`                         | 2.0.0 (2024-05-22)   | Spinner, select, text input, status components for Ink                             | Requires Ink                                                        | Stale (2024). Use only with Ink.                                                            |
| `ink-spinner`                       | 5.0.0 (2024-05-21)   | Spinner                                                                            | Requires Ink                                                        | Stale.                                                                                      |
| `ink-select-input`                  | 6.2.0 (2025-04-29)   | Select list                                                                        | Requires Ink                                                        | Stale-ish.                                                                                  |
| `ink-text-input`                    | 6.0.0 (2024-05-21)   | Text input                                                                         | Requires Ink                                                        | Stale.                                                                                      |
| `marked-terminal`                   | 7.3.0 (2025-01-28)   | Markdown to ANSI for `marked`                                                      | Depends on `marked`                                                 | Last release over a year old; fine for static markdown, check streaming behaviour.          |
| `cli-markdown`                      | 3.5.1 (2025-06-26)   | Markdown to ANSI                                                                   | Small                                                               | Alternative to `marked-terminal`.                                                           |
| `cli-highlight`                     | 2.1.11 (2023-04-12)  | Code highlighting for terminals (highlight.js)                                     | Pulls highlight.js                                                  | Stale. Consider `shiki` or Chroma-style highlighting if needed.                             |
| `ai` (Vercel AI SDK)                | 7.0.143 (2026-10-16) | Message and tool-call types, agent loop helpers                                    | Large; provider packages                                            | Reference only, per the constraint. Not checked for message type shapes.                    |
| `diff` (jsdiff)                     | 9.0.0 (2026-04-13)   | Unified patches                                                                    | None                                                                | Covered in sibling doc. Needed for diff previews.                                           |
| `picocolors`                        | 1.1.1 (2024-10-16)   | Colour                                                                             | None                                                                | Covered in sibling doc.                                                                     |

Notes:

- **Streaming Markdown.** Both `marked-terminal` and `cli-markdown` re-render whole documents. Codex's approach (commit at newlines, re-render only the committed prefix) is the pattern to copy if rendering cost matters.
- **Diff highlighting in a terminal.** Cheapest route: `diff` for the patch, then colour `+`, `-`, `@@` lines with `picocolors`. Syntax-highlighted diffs need a highlighter; `cli-highlight` is stale. Codex uses `syntect`; OpenCode uses an OpenTUI `<code>` element.
- **Agent harness libraries.** Pi (`@earendil-works/pi-agent-core`, not checked) is the closest reusable agent loop in TS. For this project the tool-call loop is simple enough to write directly against Ollama's `/api/chat`, so a loop library is optional.
- **Not checked:** GitHub maintenance numbers for each npm package beyond `time.modified`. Use `gh api repos/<owner>/<repo>` before pinning.

## Recommendations

### (a) Screen layout and interaction model for `harness "task"` with a y/n/a gate

Inline, not full-screen. One-shot runs do not need an alt screen, and the output stays in scrollback after exit.

```
harness v0.x · model: qwen2.5-coder:7b · cwd: ~/proj            <- header, printed once
────────────────────────────────────────────────────────────
> read src/parser.ts and fix the off-by-one                     <- task, echoed
  ⠋ thinking…                                                   <- spinner, one line, cleared on first token
  I'll look at the loop bounds first.                           <- streamed text, committed per line
  ▸ read_file src/parser.ts  (212 lines)                        <- tool call, one line, collapsed
  ▸ edit_file src/parser.ts                                      <- edit, gate follows
┌─ Apply edit to src/parser.ts? ─────────────────────────────┐
│ @@ -41,7 +41,7 @@                                           │
│ -  for (let i = 0; i <= n; i++)                             │
│ +  for (let i = 0; i < n; i++)                              │
│ … 14 more lines (press v to show all)                       │
│ [y] apply   [n] deny   [a] apply + allow edits this run     │
└─────────────────────────────────────────────────────────────┘
  ▸ run_shell "npm test"                                        <- shell gate: [y] [n] [a: this command prefix]
  ✓ tests pass (exit 0, 38 lines, v to expand)
────────────────────────────────────────────────────────────
done · 4 tool calls · 1 approval · 12.4k tokens
```

Interaction rules:

- **Gate:** y = once, n = deny (the model gets "denied by user"), a = allow for this run scoped by kind (edits to this file, or this command prefix). Esc and Ctrl-C = deny and stop the run. Use single keypress only when stdin is a TTY; otherwise require `--yes` / `--no-prompt`, and default-deny.
- **Diff preview:** unified diff, capped at about 20 lines in the prompt with "press v for more". Cap the total at Pi's 2000-line / 50 KB as a hard ceiling.
- **Tool output:** one line per tool call by default, with line count and an expand key. Store full output for the expand key; print only the summary line.
- **Streaming:** write tokens to stdout as they arrive. Commit only complete lines, as Codex does; hold a trailing partial line until newline or the end of the step. Stop the spinner on first token.
- **Prompt interleaving:** do not open the gate while a text line is partial. Finish the stream for the step first.

### (b) Recommended stack

- Node 22, ESM, strict TS, pnpm.
- Raw `fetch` to Ollama `/api/chat` with a hand-written message and tool-call type (no SDK).
- Output: `process.stdout.write` for streaming and the transcript. No React, no full-screen renderer.
- Colour: `picocolors`. Diffs: `diff` (`createTwoFilesPatch`), coloured line by line.
- Markdown: start with plain text for model output and render only fenced code. Add `marked-terminal` or `cli-markdown` later if the output needs it.
- Gate: `@clack/prompts` `selectKey` (y / n / a as single-character values), or a small readline-based prompt if `selectKey` misbehaves without a TTY. Test the non-TTY path first.
- Small-model handling: give the model a reduced tool set and a search/replace edit format, with a whole-file fallback. This follows Aider's per-model `edit_format` and Gemini's per-family manifests.

**Main alternative: `@earendil-works/pi-tui`.** It has a differential renderer, Markdown, Editor and SelectList, so it gives you live regions without React. Use it if the one-shot screen later needs a status region that updates in place. Check its engines field and that it runs on Node 22 before adopting. Its dependency set is small (`marked`, `get-east-asian-width`).

**Why not Ink 8:** React reconciler plus 23 dependencies and a JSX build step for a CLI that mostly appends lines. Use it only if the live-region need becomes real (see sibling doc).

**Why not OpenTUI:** needs Node 26.4+ or Bun. Ruled out by the Node 22 constraint.

**Why not Crush/Codex-style full screen:** Go and Rust stacks, and alt-screen ownership, which a one-shot run does not need. Borrow their patterns instead (scoped "don't ask again", collapse-and-expand, line-boundary commits).

### (c) Open questions to spike

1. **Gate on non-TTY stdin.** Does `@clack/prompts` `selectKey` throw, hang or return on piped stdin? Decide the default (`--yes` required, or default-deny) before writing the gate.
2. **Interleaving.** Does a streamed partial line followed by a `selectKey` prompt render cleanly? Test with a fake token stream and a 200 ms delay.
3. **Diff preview size.** What line cap keeps the gate readable at 80 columns? Test with 20, 40, 80 line diffs. Decide whether to wrap long lines or truncate.
4. **`@earendil-works/pi-tui` on Node 22.** Check `engines`, dependency install, and whether `TuiMainScreen` (main buffer) works without an alt screen. Measure its size.
5. **Small-model tool calling via Ollama.** Which local models reliably emit tool calls in Ollama's format, and do they need a search/replace edit format? Run a fixed set of 5 tasks per model and count malformed edits.
6. **Edit format.** Compare whole-file, search/replace, and unified-diff output on the same task for the target small model. Pick one as default with the others as fallbacks.
7. **Streaming render cost.** If markdown re-rendering is added, time `marked-terminal` on a 2000-token response. Decide whether to commit only completed blocks (Codex approach).
8. **Maintenance check.** Run `gh api repos/...` for `marked-terminal`, `cli-markdown` and `@clack/prompts` before pinning, since npm dates alone do not show activity.
9. **Claude Code behaviour beyond docs.** Not verifiable from public docs: transcript truncation and expand key. Do not copy assumptions from it without a spike.

## Sources

- Gemini CLI: https://github.com/google-gemini/gemini-cli (files cited inline)
- Codex CLI: https://github.com/openai/codex (`codex-rs/tui/...`)
- OpenCode: https://github.com/sst/opencode (`packages/tui/...`)
- Pi: https://github.com/badlogic/pi-mono (`packages/tui`, `packages/coding-agent`); https://www.npmjs.com/package/@earendil-works/pi-tui
- Crush: https://github.com/charmbracelet/crush (`go.mod`, `internal/ui/...`)
- Goose: https://github.com/block/goose (`crates/goose-cli/...`)
- Aider: https://github.com/Aider-AI/aider (`aider/io.py`, `aider/resources/model-settings.yml`); https://aider.chat/docs/more/edit-formats.html
- Claude Code: https://code.claude.com/docs/en/permissions
- npm: versions read with `npm view` on 2026-10-19
