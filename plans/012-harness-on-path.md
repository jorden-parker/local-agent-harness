# Plan 012: Run the agent as `harness "task"` from any repository

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat d56080c..HEAD -- src/cli.ts bin/harness.js package.json README.md src/config test/config`
> If any in-scope file changed since this plan was written, compare every
> "Current state" excerpt below against the live file; on any mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW (only changes how the Target Directory is chosen when started through `pnpm harness`; the plain bin keeps using the working directory)
- **Depends on**: none
- **Category**: DX & tooling
- **Planned at**: commit `d56080c`, 2026-10-19

## Why this matters

Today the README says to start a **Run** like this:

```sh
cd /path/to/some/git/repo
/path/to/local-agent-harness/bin/harness.js "make the failing test pass"
```

You have to type the full path to the harness checkout every time. `package.json` already declares `"bin": { "harness": "./bin/harness.js" }`, but nothing puts that bin on `PATH`, and the README never says how.

There is a second trap. `package.json` has a `"harness": "tsx src/cli.ts"` script, but pnpm runs scripts from the package root, and `src/cli.ts` uses `process.cwd()` as the **Target Directory**. So `pnpm -C ~/src/local-agent-harness harness "task"` points the agent at the harness repo itself, not at the repo you ran it from. If the harness tree is clean, the Model can then edit the harness's own source.

After this plan:

1. The README tells you to run `pnpm link` once in the harness checkout. After that, `harness "task"` works from any git repository.
2. `pnpm harness "task"`, started from another directory with `pnpm -C <harness checkout>`, targets the directory you ran it from (pnpm's `INIT_CWD`), not the harness checkout.

No new CLI flags. No change to Confinement, Confirmation or the Run loop.

## Current state

### Excerpts

`bin/harness.js`, the whole file. It already resolves `tsx` and `tsconfig.json` from the real location of the checkout. Node resolves symlinks for the main module, so a globally linked `harness` symlink still finds `node_modules/.bin/tsx`. **Do not change this file.**

```js
#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const tsx = join(root, "node_modules", ".bin", "tsx");
const args = ["--tsconfig", join(root, "tsconfig.json"), join(root, "src", "cli.ts")];
const result = spawnSync(tsx, [...args, ...process.argv.slice(2)], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
```

`package.json`, relevant lines:

```json
  "bin": {
    "harness": "./bin/harness.js"
  },
  "scripts": {
    "harness": "tsx src/cli.ts",
```

`src/cli.ts`, lines 18–23 (inside `main`). This is the only place that picks the Target Directory:

```ts
async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const config = await loadUserConfig();
  const model = chooseModel(args.model, config.defaultModel);
  const backendUrl = assertBackendAllowed(args.backend, config.allowedBackendHosts);
  const target = await prepareTargetDirectory(process.cwd(), args.allowDirty);
```

`src/git/target-directory.ts` `prepareTargetDirectory(directory, allowDirty)` calls `realpath(directory)`, then runs `git status --porcelain` in it. If that is not a git repo it throws `"<realpath> is not a git repository; the harness needs git to make changes reviewable"`. That happens **before** any Backend call, so the error message tells you which directory was chosen without needing Ollama. The verification steps rely on this.

`README.md`, lines 7–13 (the `## Run` section, before the flags table):

````md
## Run

```sh
pnpm install
cd /path/to/some/git/repo
/path/to/local-agent-harness/bin/harness.js "make the failing test pass"
```
````

### Environment facts (checked at `d56080c`)

- pnpm is 10.15.0. In pnpm 10, `pnpm link` with no arguments links the current package's bins into pnpm's global bin directory (`pnpm link --help`: `Usage: pnpm link <dir|pkg name>` / `pnpm link`).
- pnpm's global bin directory only exists after `pnpm setup` has been run once. That command sets `PNPM_HOME` and adds it to `PATH` in the shell profile. Without it, `pnpm link` fails with an error that mentions the global bin directory or `PNPM_HOME`.
- When pnpm runs a package script, it sets `INIT_CWD` to the directory pnpm was started from and `npm_package_name` to the package's `name` (`local-agent-harness`). `pnpm exec` does **not** set `INIT_CWD` (checked: it printed `undefined`). Step 3 checks the `pnpm run` behaviour; if it is wrong, that is a STOP condition.

### Conventions to match

- No comments anywhere, including lint suppressions (a hook enforces this). Use clear names instead.
- Small pure functions in `src/config/`, one per file, with a matching test in `test/config/`. Exemplar, `src/config/model-choice.ts`:

```ts
const FALLBACK_MODEL = "qwen3:8b";

export function chooseModel(
  flagModel: string | undefined,
  defaultModel: string | undefined,
): string {
  return flagModel ?? defaultModel ?? FALLBACK_MODEL;
}
```

and its test, `test/config/model-choice.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { chooseModel } from "../../src/config/model-choice.js";

describe("chooseModel", () => {
  it("prefers the --model flag", () => {
    expect(chooseModel("qwen3.8:27b", "qwen3:4b-instruct-2507-q4_K_M")).toBe("qwen3.8:27b");
  });
```

- Imports use the `.js` suffix (ESM with `tsx`).
- Domain words come from `GLOSSARY.md`: say **Target Directory**, not "cwd" or "workspace"; **Run**, not "session".

## Commands you will need

| Purpose   | Command                       | Expected on success             |
| --------- | ----------------------------- | ------------------------------- |
| Typecheck | `pnpm typecheck`              | exit 0                          |
| Tests     | `pnpm vitest run test/config` | all pass                        |
| All gates | `.claude/verify`              | exit 0 (typecheck, lint, tests) |
| Dead code | `npx fallow --format json`    | `total_issues` is 0             |

## Scope

**In scope**

- `src/config/target-choice.ts` (new)
- `test/config/target-choice.test.ts` (new)
- `src/cli.ts` (one line in `main`, plus one import)
- `README.md` (the `## Run` section only)

**Out of scope — do not touch**

- `bin/harness.js`. It already works through a symlink. Do not add `INIT_CWD` handling there.
- `package.json`. Keep the `harness` script as `tsx src/cli.ts`, and do not add a `link` script.
- `src/cli-args.ts`. No `--target`/`--cwd` flag; the operator chose "no new flags".
- `src/git/target-directory.ts`. Keep the git and clean-tree checks exactly as they are.
- Do **not** run `pnpm link`, `pnpm setup`, or `npm link` yourself. They change the operator's global environment, and running them from a worktree would point the global `harness` at a disposable copy.

## Git workflow

- Branch: `advisor/012-harness-on-path`.
- Conventional commit, e.g. `feat: run the harness from any repo and target the caller's directory under pnpm`.
- Do not push or open a PR unless the operator told you to.

## Steps

### Step 1: `chooseTargetDirectory` (test first)

Create `test/config/target-choice.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { chooseTargetDirectory } from "../../src/config/target-choice.js";

describe("chooseTargetDirectory", () => {
  it("uses the working directory when started directly", () => {
    expect(chooseTargetDirectory({}, "/repo")).toBe("/repo");
  });

  it("uses the directory pnpm was started from for this package's script", () => {
    const env = { npm_package_name: "local-agent-harness", INIT_CWD: "/other/repo" };
    expect(chooseTargetDirectory(env, "/harness")).toBe("/other/repo");
  });

  it("ignores INIT_CWD set by another package's script", () => {
    const env = { npm_package_name: "some-app", INIT_CWD: "/some-app/sub" };
    expect(chooseTargetDirectory(env, "/some-app")).toBe("/some-app");
  });

  it("uses the working directory when pnpm sets no INIT_CWD", () => {
    expect(chooseTargetDirectory({ npm_package_name: "local-agent-harness" }, "/harness")).toBe(
      "/harness",
    );
  });
});
```

The third case matters. A globally linked `harness` may be started from some other project's npm script. That project's `INIT_CWD` must not override the working directory.

Verify: `pnpm vitest run test/config/target-choice.test.ts` → fails because the module does not exist.

Create `src/config/target-choice.ts`:

```ts
const HARNESS_PACKAGE_NAME = "local-agent-harness";

export function chooseTargetDirectory(
  env: Record<string, string | undefined>,
  workingDirectory: string,
): string {
  const startedByOwnScript = env.npm_package_name === HARNESS_PACKAGE_NAME;
  return (startedByOwnScript ? env.INIT_CWD : undefined) ?? workingDirectory;
}
```

`process.env` (type `NodeJS.ProcessEnv`) can be passed for `env` as-is.

Verify: `pnpm vitest run test/config/target-choice.test.ts` → 4 passed.

### Step 2: Use it in `src/cli.ts`

Add the import next to the other `./config/` imports, in alphabetical order:

```ts
import { chooseTargetDirectory } from "./config/target-choice.js";
```

Change the one line in `main`:

```ts
const target = await prepareTargetDirectory(process.cwd(), args.allowDirty);
```

to

```ts
const target = await prepareTargetDirectory(
  chooseTargetDirectory(process.env, process.cwd()),
  args.allowDirty,
);
```

(Let prettier decide the line breaks: run `pnpm prettier --write src/cli.ts` in the worktree.)

Verify: `pnpm typecheck` → exit 0.

### Step 3: Prove both start paths choose the right directory

Without Ollama, use a directory that is **not** a git repo. The error names the directory that was chosen. In fish or bash, from the worktree root:

```sh
NOT_A_REPO=$(mktemp -d)
LINK_DIR=$(mktemp -d)
ln -s "$PWD/bin/harness.js" "$LINK_DIR/harness"
(cd "$NOT_A_REPO" && "$LINK_DIR/harness" "say hi"); echo "exit=$?"
(cd "$NOT_A_REPO" && pnpm -C "$OLDPWD" harness "say hi"); echo "exit=$?"
```

(If `$OLDPWD` is unreliable in your shell, substitute the absolute worktree path.)

Expected:

1. The symlinked bin (stands in for what `pnpm link` creates) prints, in red, `<realpath of $NOT_A_REPO> is not a git repository; the harness needs git to make changes reviewable`, then `exit=1`. On macOS the realpath starts with `/private/var/folders/...`.
2. `pnpm -C ... harness` prints the **same** `$NOT_A_REPO` message, not one that names the worktree. pnpm may add its own `ELIFECYCLE` line and exit non-zero. That is fine.

Before this plan, run 2 would have used the worktree (a git repo) and failed later, with a dirty-tree error or by trying to reach Ollama. That is the bug.

Clean up: `rm -rf "$NOT_A_REPO" "$LINK_DIR"`.

### Step 4: README

Replace the `## Run` code block (README lines 9–13, shown under Current state) with:

````md
Once, in this checkout:

```sh
pnpm install
pnpm link        # puts `harness` on PATH; run `pnpm setup` first if pnpm reports no global bin directory
```

Then, from any git repository:

```sh
harness "make the failing test pass"
```

Without linking, `pnpm -C /path/to/local-agent-harness harness "task"` does the same and targets the directory you ran it from.
````

Leave the rest of the README alone: the flags table and everything after it.

Verify: `pnpm prettier --check README.md` → exit 0. If it fails, run `pnpm prettier --write README.md` and check that only whitespace changed.

### Step 5: Gates

- `.claude/verify` → exit 0.
- `npx fallow --format json` → `total_issues` is 0.
- `git diff --stat main` → only the four in-scope files.

## Test plan

- New: `test/config/target-choice.test.ts`, the four cases in Step 1, patterned on `test/config/model-choice.test.ts`.
- Manual (Step 3): the symlinked bin and `pnpm -C` both choose the caller's directory, shown by the "not a git repository" error.
- Existing: `test/cli-args.test.ts` and the rest of the suite must still pass. Nothing else uses `process.cwd()` for the Target Directory.

## Done criteria

- `pnpm vitest run test/config/target-choice.test.ts` → 4 passed.
- `.claude/verify` → exit 0.
- `npx fallow --format json` → `total_issues` is 0.
- Step 3 run 2's error message names the temp directory, not the worktree.
- `grep -n "bin/harness.js \"" README.md` → no matches (the long-path invocation is gone from `## Run`).
- `git diff --name-only main` → exactly `README.md`, `src/cli.ts`, `src/config/target-choice.ts`, `test/config/target-choice.test.ts`.

## STOP conditions

- Any "Current state" excerpt does not match the live file.
- In Step 3, `pnpm -C ... harness` still names the worktree after Step 2. That means pnpm 10 does not set `INIT_CWD` or `npm_package_name` the way this plan assumes. Report what `pnpm -C <worktree> run harness` sees: temporarily add `"env-probe": "node -e \"console.log(process.env.INIT_CWD, process.env.npm_package_name)\""` to `package.json`, run it from a temp dir, report the output, then revert the change. Do not switch to a different env var on your own.
- In Step 3, the symlinked bin fails with an `ENOENT` for `tsx`, or exits 1 without printing anything. That means the bin does not resolve through symlinks. Report it; do not edit `bin/harness.js`.
- Any change seems to need a new CLI flag or an edit to `package.json`.

## Maintenance notes

- `HARNESS_PACKAGE_NAME` must match `"name"` in `package.json`. If the package is renamed, update both, or `pnpm harness` silently goes back to targeting the checkout.
- A globally linked `harness` runs whatever is checked out in the linked directory. After `git pull`, run `pnpm install` there too. The bin exits 1 with no message if `node_modules/.bin/tsx` is missing (`spawnSync` sets `result.error`, which nothing prints). That is a small follow-up worth its own plan if it bites.
- Later plans that add a "target" concept (e.g. a `--target` flag or a Sandbox) should route through `chooseTargetDirectory` rather than reading `process.cwd()` again.
