# Ink 8 RunView spike: findings

PROTOTYPE. Throwaway. Lives on `spike/ink-run-view`, never on main.

Run: `pnpm install && pnpm start` in this folder. Flags: `--naive`, `--incremental`, `--rate <tokens/s>`, `--auto`.
Keys: `t` thinking, `o` tool output, `ctrl+o` transcript (↑ ↓ pgup pgdn, esc), `y` `n` `a` `esc` at a gate.

## Question

Does Ink 8 flicker while streaming tokens, and does `<Static>` plus a transcript screen support toggling thinking and tool output?

## Verdict

Yes, with one rule: **the live region must stay shorter than the terminal.** Commit each finished line to `<Static>` and keep only the partial line, spinner, pending gate and footer live.

## Measurements

Scripted run, 58-row cmux pane, recorded with `script`:

| Mode | Bytes written | Full clears | Erase-line | Scrollback duplicates |
|---|---|---|---|---|
| line commit, 40 tok/s | 338 KB | 0 | 5,643 | none |
| line commit, 400 tok/s | 271 KB | 0 | 4,512 | none |
| naive (whole block live) | 3.3 MB | 0 | 21,953 | about 750 copies of one row |
| naive + `incrementalRendering` | 2.1 MB | 0 | 107 | same smearing |

- Ink 8 wraps every frame in synchronized output (`ESC[?2026h` / `l`), so supporting terminals show no tearing.
- `maxFps` 30 caps redraws, so 400 tok/s writes fewer bytes than 40 tok/s.
- Naive mode smears: once the live region is taller than the screen, each frame's overflow scrolls into scrollback for good. `incrementalRendering` does not fix that.

## Toggles and transcript

- Toggles change everything rendered after the keypress. Lines already in `<Static>` stay as printed.
- Hidden thinking collapses to `∴ thinking · N chars hidden`.
- `ctrl+o` opens a full-screen transcript with everything expanded, using `instance.clear()` and then `ESC[?1049h`. Closing it with `clear()` and `ESC[?1049l` restored scrollback with nothing duplicated.
- Lines finished while the transcript is open are held and committed on close. Otherwise they would print to the alternate screen and be lost.
- The gate footer moves into a real bottom bar (`y yes  n no  a allow every edit  esc counts as no`), matching the design.

## Spacing and sizing

One `Line = { gutter, body }` model renders every row, both live and in the transcript:

- The gutter is a fixed-width box (`flexShrink 0`). The body wraps inside its own box, so wrapped text hangs at column 2. The hand-rolled view can't do this cheaply.
- Every blank line comes from one rule, `blankLinesBefore(previous, next)`: one blank line between blocks, and none before a tool line under a reply, tool or gate.
- The constants live in `SPACING`: marker column 0, text column 2, tool text column 4, footer gap 1, rule width 60, tool output cap 8.
- An empty `<Text>` takes zero rows, so a blank line must hold `" "`.
- The transcript truncates lines instead of wrapping them, so page maths stays exact.

## Open issues

- Two committed rows displayed about 62 columns to the right in the cmux scrollback. Ink wrote identical bytes for a correct row and a shifted one (`ESC[2K ESC[1A … ESC[G`), so it looks like a terminal or scrollback-capture artifact. Recheck in iTerm2 or Ghostty.
- Ink adds `react` (19.3) and the Ink dependency tree. Node 22 is fine.
- Not yet tried: streaming from a real Ollama backend, resizing the terminal mid-stream, and Ctrl+C cleanup while the transcript is open.
