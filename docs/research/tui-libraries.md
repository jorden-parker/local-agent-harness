# TUI libraries for `harness "task"`: research notes

Date of research: 2026-10-19. Target: Node 22, ESM, TypeScript strict, pnpm.

## Needs

1. Stream model text to the terminal as tokens arrive.
2. Blocking confirmation with choices y / n / a, shown with a unified diff (edits) or a command string (shell).
3. Scrolling transcript of model text and tool results. The run is one-shot, so an append-only log may suffice.

Sources for version, date and dependency data are npm (`npm view <pkg>`) and the GitHub API (`pushed_at`, `open_issues_count`) unless a URL is given. Figures were read on 2026-10-19.

## Summary table

| Library                  | Latest (date)       | Last push  | Open issues | Node engines                  | Direct deps               | Streaming             | Blocking prompt                     | Diff                          |
| ------------------------ | ------------------- | ---------- | ----------- | ----------------------------- | ------------------------- | --------------------- | ----------------------------------- | ----------------------------- |
| Ink                      | 8.0.0 (2026-10-03)  | 2026-10-03 | 31          | `>=22`                        | 23                        | Yes (React state)     | Via `useInput` (custom)             | None built in                 |
| OpenTUI `@opentui/core`  | 0.6.6 (2026-10-14)  | 2026-10-17 | 199         | `node >=26.4`, `bun >=1.3.14` | 4 + native optional       | Yes                   | Via selects/inputs                  | Uses `diff` internally        |
| blessed                  | 0.1.81 (2024-10-22) | 2024-03-22 | 254         | none declared                 | 0                         | Yes                   | Yes (widgets)                       | None                          |
| neo-blessed              | 0.2.0 (2022-05-10)  | 2021-04-24 | 39          | `>=8`                         | 0                         | Yes                   | Yes (widgets)                       | None                          |
| `@clack/prompts`         | 1.8.1 (2026-09-13)  | 2026-10-15 | 93          | `>=20.12`                     | 4                         | No (spinner/log only) | Yes (`confirm`, `selectKey`)        | None                          |
| `@inquirer/prompts`      | 8.7.3 (2026-10-04)  | 2026-10-15 | 17          | `>=22.13` (or 20.17, 23.5)    | ~10 (per-prompt packages) | No                    | Yes (`expand`, `select`, `confirm`) | None                          |
| Node `readline/promises` | built in            | n/a        | n/a         | Node 22                       | 0                         | Via `stdout.write`    | Via `rl.question`                   | None                          |
| `picocolors`             | 1.1.1 (2024-10-16)  | 2024-11-18 | 17          | any                           | 0                         | n/a                   | n/a                                 | n/a                           |
| `diff` (jsdiff)          | 9.0.0 (2026-04-13)  | 2026-10-19 | 26          | any                           | 0                         | n/a                   | n/a                                 | Yes, produces unified patches |

Sources: npm registry metadata for each package (the `time.modified`, `engines`, `dependencies` fields). GitHub repos:

- Ink: https://github.com/vadimdemedes/ink
- OpenTUI: https://github.com/anomalyco/opentui (also `sst/opentui`, which redirects there)
- blessed: https://github.com/chjj/blessed
- neo-blessed: https://github.com/embarklabs/neo-blessed
- Clack: https://github.com/bombshell-dev/clack
- Inquirer.js: https://github.com/SBoudrias/Inquirer.js
- picocolors: https://github.com/alexeyraspopov/picocolors
- jsdiff: https://github.com/kpdecker/jsdiff

## Per-library notes

### Ink (React for CLIs)

- **Version and maintenance:** 8.0.0, published 2026-10-03. Repo pushed the same day, 31 open issues, 40k stars. https://github.com/vadimdemedes/ink
- **Node, ESM, TS:** `"type": "module"`, `engines: { node: ">=22" }`. Peer deps are `react >=19.3.0`, `@types/react >=19.3.0`, `react-devtools-core >=6.1.2`. https://www.npmjs.com/package/ink
- **Weight:** 23 direct dependencies (including `yoga-layout`, `react-reconciler`, `chalk`, `string-width`, `wrap-ansi`). Plus React itself.
- **Streaming:** State updates re-render the tree, so each token can be a `setState`. For an append-only log, `<Static>` "permanently renders its output above everything else" and only renders newly added items. https://github.com/vadimdemedes/ink#static
- **Blocking prompt:** Ink has none. Build one with `useInput(inputHandler)`, which "is called for each character when the user enters any input." https://github.com/vadimdemedes/ink#useinputinputhandler-options. The app must stay alive while waiting on that handler, and the README notes an Ink app "stays alive only while there is active work in the event loop (... `useInput` listening on `stdin`)." https://github.com/vadimdemedes/ink#readme
- **Diff:** Nothing built in. Compute the patch with `diff` and colour it with `chalk` or `picocolors` inside `<Text color>`.
- **Gotchas:**
  - Requires a React 19.3+ toolchain and JSX/TSX compilation. This adds a build step for a small CLI.
  - Ink 8 is a new major (2026-10-03). Check its changelog before pinning.
  - Lines written with `console.log` during a render are not handled. Route all output through Ink.

### OpenTUI (`@opentui/core`, `@opentui/react`)

- **Version and maintenance:** core 0.6.6 and react 0.6.6, both published 2026-10-14. Repo pushed 2026-10-17, 199 open issues, 13.6k stars. https://github.com/anomalyco/opentui and https://opentui.com
- **Node, ESM, TS:** Declares `engines: { bun: ">=1.3.14", node: ">=26.4.0" }`. That excludes Node 22. https://www.npmjs.com/package/@opentui/core
- **Weight:** Core depends on `diff`, `marked`, `string-width`, `bun-ffi-structs`, plus eight optional native packages (`@opentui/core-darwin-arm64`, etc.). The unpacked size is about 17.7 MB. `@opentui/react` peers on `react >=19.2.0`, `react-devtools-core` and `ws`.
- **Streaming and prompt:** It is a full-screen renderer with flexbox, selects, inputs and scroll boxes, and it has mouse support. https://github.com/anomalyco/opentui#readme
- **Diff:** Core depends on `diff`, but I did not verify a public diff-view component.
- **Gotchas:**
  - Dev workflow needs Bun 1.4.1+ and Zig 0.16.0. https://github.com/anomalyco/opentui#readme
  - Node 22 is not supported, so this rules out the stated runtime.
  - Recent releases (0.6.x) and 199 open issues suggest an API that is still moving.
- **Verdict:** Not usable under the Node 22 constraint. Revisit if the project moves to Node 26 or Bun.

### blessed / neo-blessed

- **Maintenance:** `blessed` last pushed 2024-03-22 (npm 0.1.81, 2024-10-22). `neo-blessed` last pushed 2021-04-24 (npm 0.2.0, 2022-05-10). Both are effectively stale. https://github.com/chjj/blessed and https://github.com/embarklabs/neo-blessed
- **Model:** Imperative widget tree (`blessed.box`, `blessed.log`, etc.), not React. Good for a scrolling log widget. Not ESM-first, with no types in the core package, so TS strict needs `@types/blessed`.
- **Verdict:** Do not adopt for new work. Stale releases and CJS-era API.

### @clack/prompts (with @clack/core)

- **Version and maintenance:** 1.8.1, published 2026-09-13. Repo pushed 2026-10-15, 93 open issues, 8.1k stars. https://github.com/bombshell-dev/clack
- **Node, ESM, TS:** `"type": "module"`, `engines: { node: ">= 20.12.0" }`. Runtime deps: `sisteransi`, `@clack/core`, `fast-wrap-ansi`, `fast-string-width`. Unpacked size about 94 KB.
- **Blocking prompt:** `confirm` returns a boolean. `selectKey` "lets a user choose an option by pressing its single-character string `value` key directly", so it maps cleanly to y / n / a. https://github.com/bombshell-dev/clack/blob/main/packages/prompts/README.md#select-key
- **Streaming:** Not a streaming UI. It has `spinner` and `progress` for pending work. Use `process.stdout.write` for tokens and let clack handle only the prompt.
- **Diff:** Not built in. Print the diff with `picocolors` before calling `selectKey`. Clack README: https://github.com/bombshell-dev/clack/blob/main/packages/prompts/README.md
- **Gotchas:**
  - Clack takes over the terminal for each prompt. Test that printed token output and the prompt do not interleave badly (a streamed line can be left partial before the prompt).
  - The `selectKey` `value` must be a single character, so use `y`, `n`, `a` as the values.
  - I did not verify how `selectKey` handles a non-TTY stdin. Test that path (CI, piped stdin) before relying on it.

### @inquirer/prompts (Inquirer.js)

- **Version and maintenance:** 8.7.3, published 2026-10-04. Repo pushed 2026-10-15, 17 open issues, 21.6k stars. https://github.com/SBoudrias/Inquirer.js
- **Node, ESM:** The README notes Inquirer was rewritten "to reduce the package size and improve performance." The package declares `engines: { node: ">=23.5.0 || ^22.13.0 || ^20.17.0" }`, so Node 22.13+ works. https://github.com/SBoudrias/Inquirer.js#readme
- **Blocking prompt:** `@inquirer/expand` is the closest fit. It is a "compact single select prompt. Every option is assigned a shortcut key." Options `y`, `n`, `a` map directly. https://github.com/SBoudrias/Inquirer.js/tree/main/packages/expand. `confirm` is for plain yes/no.
- **Weight:** Modular. `@inquirer/prompts` pulls about ten per-prompt packages plus `@inquirer/core`. Install only `@inquirer/expand` if that is the only prompt needed.
- **Streaming:** No. Same approach as clack.
- **Diff:** Not built in.
- **Gotchas:** The README says the previous Inquirer package is maintained but not developed, so use the new `@inquirer/*` packages, not the old `inquirer`.

### Node `readline` / `readline/promises`

- **Built in, no deps, Node 22 stable.** Docs: https://nodejs.org/api/readline.html (not fetched in this session; behaviour noted from the Node docs).
- **Streaming:** `process.stdout.write(token)` writes tokens as they arrive with no framework.
- **Blocking prompt:** `const rl = readline/promises.createInterface(...)`, then `await rl.question('Apply? [y/n/a] ')`. Loop until the answer is y, n or a. This is line-based (press Enter), not single-key, unless you use raw mode.
- **Diff:** None. Use `diff` for the patch text and `picocolors` for colour.
- **Gotchas:** Single-key input needs `process.stdin.setRawMode(true)` and careful cleanup on Ctrl-C. A line-based prompt (`y` + Enter) is fine for a CLI and avoids that.

### picocolors

- **Version:** 1.1.1, published 2024-10-16. Repo pushed 2024-11-18, 17 open issues. Dependency-free, about 6 KB unpacked. https://github.com/alexeyraspopov/picocolors and https://www.npmjs.com/package/picocolors
- **Use:** Colour the diff lines and the command string. Pair with `diff`.
- **Note:** It is stable, not actively developed. Still a fine choice for a dependency-free colour helper. `chalk` 6.0.1 (published 2026-09-27) is ESM-only and has more deps; use it only if you already need it.

### diff (jsdiff)

- **Version:** 9.0.0, published 2026-04-13. Repo pushed 2026-10-19, 26 open issues. Dependency-free. https://github.com/kpdecker/jsdiff
- **Unified diff:** `createTwoFilesPatch(oldFileName, newFileName, oldStr, newStr[, ...])` "creates a unified diff patch." `createPatch` is the single-file variant. The package ships ESM and CJS. https://github.com/kpdecker/jsdiff#readme
- **Use:** Build the patch for an edit preview, then colour it line by line (`+` green, `-` red, `@@` cyan).
- **Gotchas:** The output is a string with headers; strip or keep the header lines as needed. Large files produce large previews, so truncate the diff shown in the prompt.

## Cross-cutting findings

- **Streaming + prompt interleaving:** Every option that writes to stdout needs one owner for the cursor. For Ink, route everything through React. For the plain stack, stream with `process.stdout.write` and only start a prompt once the stream for that step has ended, so a half-written token line is not left in front of the prompt.
- **Node 22 is the binding constraint.** It rules out OpenTUI (Node 26.4+). Ink 8 and Inquirer both accept Node 22.
- **Blocking y/n/a:** `@inquirer/expand` and `@clack/prompts` `selectKey` both do single-key choices. `readline/promises` does line-based.
- **Not verified:** Context7 and a web search were not run in this session. The findings above come from npm metadata, GitHub API data and README text. Verify the `selectKey` non-TTY behaviour and the Ink flicker behaviour during token streaming by a small spike before committing.

## Recommendation

**Simplest stack that covers the three needs:**

- `picocolors` for colour, `diff` for unified patches, and `process.stdout.write` for streamed tokens and the append-only transcript (no framework).
- `@clack/prompts` `selectKey` (or `@inquirer/expand` if you want Inquirer's key-shortcut semantics) for the blocking y / n / a prompt, after printing the diff or command.
- Zero framework: one module per concern (stream writer, diff renderer, confirm prompt), each a small function. Node 22, ESM, strict TS all work.

**When to upgrade to a full TUI framework:**

- Ink 8 when the UI needs live, re-rendered regions: a status line updating while the model streams, a pane of tool calls, a spinner per tool, or resize-aware layout. Accept the React and 23-dependency cost.
- OpenTUI only when the project moves to Node 26.4+ or Bun, and needs mouse, scroll boxes or split panes. Do not adopt it on Node 22.
- Stay away from blessed and neo-blessed for new work (stale since 2024 and 2021).
