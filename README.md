# local-agent-harness

A small, readable agent loop that drives Qwen-family local models through Ollama with six tools against one git repository. Built for learning how harnesses work and for cheap grunt work on code you cannot send to a cloud API.

See `GLOSSARY.md` for the vocabulary used in the code.

## Run

```sh
pnpm install
cd /path/to/some/git/repo
/path/to/local-agent-harness/bin/harness.js "make the failing test pass"
```

Flags:

| Flag                | Default                  | Meaning                                                   |
| ------------------- | ------------------------ | --------------------------------------------------------- |
| `--model`           | see below                | Any Ollama model with tool support, e.g. `qwen3.8:27b`    |
| `--backend`         | `http://localhost:11434` | Ollama URL; non-local hosts must be allow-listed          |
| `--yolo`            | off                      | Skip the y / n / a confirmation gate                      |
| `--allow-secrets`   | off                      | Let the model read `.env*`, `*.pem`, keys and credentials |
| `--allow-dirty`     | off                      | Run on a repo with uncommitted changes                    |
| `--think`           | off                      | Let the model use Qwen's thinking phase                   |
| `--num-ctx`         | `32768`                  | Context window passed to Ollama                           |
| `--max-iterations`  | `50`                     | Hard cap on tool calls per run                            |
| `--timeout-minutes` | `20`                     | Wall-clock cap per run                                    |

Without `--model`, the harness uses `defaultModel` from `~/.config/harness/config.json`, falling back to `qwen3:8b`. Set it per machine to whatever that machine has pulled:

```json
{ "defaultModel": "qwen3:4b-instruct-2507-q4_K_M" }
```

Prefer instruct builds. Thinking-only builds such as the current `qwen3:4b` tag ignore `--think` being off and reason at length before every tool call.

Every run writes a JSONL log to `.harness/runs/` inside the target repo. The folder ignores itself, so nothing lands in git.

## Safety model

- Every file tool is confined to the target repository. Paths that escape via `..`, absolute paths or symlinks are rejected before the tool runs.
- `.harness/`, `.git/` and `.gitignore` are never writable by tools.
- Secret-looking files are unreadable unless you pass `--allow-secrets`.
- `write`, `edit` and `shell` ask for confirmation with a diff or command preview. `a` allows that tool for the rest of the run. `--yolo` skips the gate.
- A short denylist of destructive shell shapes (`rm -rf /`, `git push --force`, `curl | sh`, `sudo`, `mkfs`, `dd if=`) is never run, even under `--yolo`.
- The backend must be localhost or a host listed in `~/.config/harness/config.json` as `allowedBackendHosts`.
- The target must be a git repo with a clean tree, so `git diff` reviews and `git checkout .` reverts everything the model did.
- Three consecutive failed tool calls, including declines, end the run.

Shell commands are **not** sandboxed from the network or the rest of the filesystem. The denylist covers common destructive shapes, not every possible one. Treat `--yolo` as trusting the model with your shell.

## Develop

```sh
pnpm test          # unit tests with a fake backend
pnpm test:live     # one smoke test against local Ollama (qwen3:4b)
pnpm typecheck && pnpm lint
```

`prototypes/run-loop-prototype.html` is the throwaway state-machine demo that settled the loop rules. Open it in a browser. `docs/research/` holds the TUI library survey.

## Known small-model quirks

- qwen3:4b leaks its reasoning into the answer even with thinking off. The harness streams it to the terminal but strips everything up to the last `</think>` before storing the message, so the context window is not wasted on it.
