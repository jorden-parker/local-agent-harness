# Plan 008: Enforce protected and secret paths on the real, case-folded path

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat d1ce0d8..HEAD -- src/tools/confinement.ts src/tools/target-path.ts src/run/run-loop.ts test/tools/confinement.test.ts test/run/run-loop.test.ts`
> If any in-scope file changed since this plan was written, compare every
> "Current state" excerpt below against the live file; on any mismatch, STOP.

## Status

- **Priority**: P0
- **Effort**: S–M
- **Risk**: LOW (only rejects more calls; no change for ordinary paths)
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `d1ce0d8`, 2026-10-19

## Why this matters

**Confinement** is the rule that file tools only touch the **Target Directory** and never touch `.git/`, `.harness/` or `.gitignore`, or secret-pattern files (unless `--allow-secrets` is passed). Today those checks compare the **path string the Model typed**, case-sensitively. Two gaps were reproduced on macOS on 2026-10-19:

1. **Letter case.** macOS file systems are case-insensitive by default, so an upper-case spelling of `.git` or `.env` passes the string check but reaches the real protected or secret file. Reading a secret this way needs no Confirmation. A write into git's hooks folder gives code execution the next time the user runs git.
2. **Symlink aliases.** If the repo contains a symlink inside the Target Directory that points at `.git` (or at a secret file), a path through that symlink passes the string check. The existing realpath check in `target-path.ts` only verifies the path stays **inside** the Target Directory, which `.git` is. The write/edit preview also reads through such a symlink before any check runs.

The secret list is also thin: `.npmrc`, `.netrc`, `.pypirc`, `.envrc`, `.pgpass`, `id_ecdsa`/`id_dsa`, and `*.p12`/`*.pfx` are readable.

After this plan, both the string check and a new check against the resolved real path use case-folded protected and secret rules. The real-path check runs **before** the preview or the tool.

## Current state

### Files and roles

- `src/tools/confinement.ts` — synchronous string checks called from `gateToolCall` in `src/run/run-state.ts`.
- `src/tools/target-path.ts` — `resolveInsideTarget` (realpath-based inside-the-target check, used by `read`/`write`/`edit`) and the private `nearestExistingRealPath`.
- `src/run/run-loop.ts` — `resolveGate` decides reject / run / confirm. The preview (`buildPreview`) is built before the Confirmation.
- `src/gate/preview.ts:17` — `readFile(resolve(target, path))` for the diff preview. **Do not change it**; ordering in `resolveGate` protects it.

### Verified behaviour

On macOS, `fs.promises.realpath` returns the on-disk letter case for existing path components. For example, a path spelt with `.GIT/hooks` resolves to `.../.git/hooks`, and a path through a symlink `docs -> .git` resolves to `.../.git/hooks`.

### Excerpts

`src/tools/confinement.ts:7-15` and `:40-50`, `:66-76`:

```ts
const PROTECTED_PREFIXES = [".harness/", ".git/"];
const PROTECTED_FILES = new Set([".gitignore", ".harness", ".git"]);
const SECRET_PATTERNS = [
  /^\.env(\..*)?$/,
  /\.pem$/,
  /^id_(rsa|ed25519)$/,
  /credentials/i,
  /\.key$/,
];

function pathError(call: ToolCall, flags: ConfinementFlags): string | null {
  if (call.name === "glob" || call.name === "grep") return null;
  const path = stringArgument(call, "path");
  if (path.startsWith("/")) return "absolute paths are not allowed";
  const relative = normaliseRelativePath(path);
  if (relative === null) return "path escapes the target directory";
  if (isProtected(relative)) return "protected path";
  if (!flags.allowSecrets && isSecret(relative))
    return "secret-pattern file; rerun with --allow-secrets";
  return null;
}

function isProtected(relative: string): boolean {
  return (
    PROTECTED_FILES.has(relative) ||
    PROTECTED_PREFIXES.some((prefix) => relative.startsWith(prefix))
  );
}

function isSecret(relative: string): boolean {
  const basename = relative.split("/").pop() ?? relative;
  return SECRET_PATTERNS.some((pattern) => pattern.test(basename));
}
```

`src/tools/target-path.ts:18-27`:

```ts
async function nearestExistingRealPath(absolute: string): Promise<string> {
  try {
    return await realpath(absolute);
  } catch {
    const parent = dirname(absolute);
    if (parent === absolute) return absolute;
    const realParent = await nearestExistingRealPath(parent);
    return resolve(realParent, absolute.slice(parent.length + 1));
  }
}
```

`src/run/run-loop.ts` `resolveGate` (current):

```ts
if (gated.gate.kind === "reject")
  return { state: gated.state, outcome: { ok: false, output: `rejected: ${gated.gate.reason}` } };
if (gated.gate.kind === "run") return runTool(gated.state, call, options);
const preview = await buildPreview(options.target, call);
deps.view.confirmationStarted();
const choice = await deps.confirmer.confirm(call, preview);
```

`recordToolOutcome(state, succeeded)` is exported from `src/run/run-state.ts` and counts a failure toward the three-failure limit.

### Conventions to match

- Pure helpers with direct tests: `test/tools/confinement.test.ts` (sync cases, with a `call(name, args)` helper) and `test/tools/execute-tool.test.ts` (`mkdtemp` + `realpath` target, `symlink` setup in `"refuses to follow a symlink out of the target"`).
- **No code comments of any kind**, including lint suppressions. A hook rejects them.
- Glossary: **Confinement**, **Target Directory**, **Tool Call**, **Confirmation**. Rejection strings are short, lower-case phrases like `"protected path"`.

## Commands you will need

| Purpose   | Command                               | Expected on success          |
| --------- | ------------------------------------- | ---------------------------- |
| Typecheck | `pnpm typecheck`                      | exit 0                       |
| Tests     | `pnpm vitest run test/tools test/run` | all pass                     |
| All gates | `.claude/verify`                      | exit 0                       |
| Dead code | `npx fallow --format json`            | no findings in changed files |

## Scope

**In scope**:

- `src/tools/confinement.ts`, `test/tools/confinement.test.ts`
- `src/tools/target-path.ts`
- `src/run/run-loop.ts`, `test/run/run-loop.test.ts`
- `README.md` (the secret-file bullet in "Safety model")

**Out of scope**:

- `glob` and `grep` confinement — plan 009 (it reuses the helpers exported here).
- `src/gate/preview.ts` and `src/tools/file-tools.ts`.
- The shell denylist.

## Git workflow

- Branch: `advisor/008-confine-real-paths`.
- Conventional commit, e.g. `fix: check protected and secret paths on the real path`.
- Do not push or open a PR unless the operator told you to.

## Steps

### Step 1: Case-fold the string checks and widen the secret list (test first)

Add to `test/tools/confinement.test.ts`:

- `read` of `.ENV` → matches `/secret/`;
- `write` of `.GIT/hooks/x` → `"protected path"`;
- `write` of `.Harness/runs/x` → `"protected path"`;
- `read` of each of `.npmrc`, `.netrc`, `.pypirc`, `.envrc`, `.pgpass`, `id_ecdsa`, `id_dsa`, `cert.p12`, `cert.pfx`, `prod.env` and `.env.local` → matches `/secret/` (use `it.each`);
- `read` of `id_ed25519.pub`, `src/environment.ts` and `docs/env.md` → `null` (no false positives).

In `src/tools/confinement.ts`:

- export `isProtectedPath(relative: string): boolean` and `isSecretPath(relative: string): boolean` (rename the private functions). Both lower-case their input first;
- replace `SECRET_PATTERNS` with case-insensitive patterns matched against the lower-cased basename:
  `/^\.env(rc)?(\..+)?$/`, `/\.env$/`, `/\.(pem|key|p12|pfx)$/`, `/^id_(rsa|dsa|ecdsa|ed25519)$/`, `/credentials/`, `/^\.(npmrc|netrc|pypirc|pgpass)$/`.

**Verify**: `pnpm vitest run test/tools/confinement.test.ts` → all pass, old and new.

### Step 2: Real-path check (test first)

In `src/tools/target-path.ts`, export `nearestExistingRealPath` unchanged.

In `src/tools/confinement.ts` add and export:

```ts
export async function realPathError(
  target: string,
  call: ToolCall,
  flags: ConfinementFlags,
): Promise<string | null>;
```

- return `null` for `glob`, `grep` and `shell`;
- otherwise compute `real = await nearestExistingRealPath(resolve(target, path))` and `relativeReal = relative(target, real)`;
- if `relativeReal` starts with `..` or is absolute → `"path escapes the target directory"`;
- if `isProtectedPath(relativeReal)` → `"protected path"`;
- if `!flags.allowSecrets && isSecretPath(relativeReal)` → `"secret-pattern file; rerun with --allow-secrets"`;
- else `null`;
- wrap the body in the same try/catch shape as `confinementError`, so a bad argument becomes a message rather than a throw.

`target` here is already a real path (`prepareTargetDirectory` and the tests both `realpath` it).

Tests, as a new `describe("realPathError")` in `test/tools/confinement.test.ts`, using a `mkdtemp` + `realpath` target containing `mkdir .git/hooks`, a file `.env`, and the symlinks `docs -> .git` and `notes.txt -> .env`:

- `write` `docs/hooks/x` → `"protected path"`;
- `read` `notes.txt` → matches `/secret/`;
- the same `read` with `{ allowSecrets: true }` → `null`;
- `read` `.GIT/HEAD` → `"protected path"`. Create `.git/HEAD` first. On a case-sensitive file system this resolves to a non-existent path, so it would still be rejected by Step 1's string check. Assert on `confinementError(...) ?? await realPathError(...)` so the test passes on both kinds of file system;
- `write` `src/new.ts` (a parent that does not exist yet) → `null`.

**Verify**: `pnpm vitest run test/tools` → all pass.

### Step 3: Run the real-path check before preview and execution

In `src/run/run-loop.ts` `resolveGate`, right after the `reject` branch and before both the `run` branch and `buildPreview`:

```ts
const realError = await realPathError(options.target, call, options.flags);
if (realError !== null)
  return {
    state: recordToolOutcome(gated.state, false),
    outcome: { ok: false, output: `rejected: ${realError}` },
  };
```

Extract a tiny `rejected(state, reason)` helper if the two reject returns would otherwise repeat.

Add a test in `test/run/run-loop.test.ts`. In `beforeEach`'s target, create `.git` and a symlink `docs -> .git`. Script a `write` to `docs/hooks/pre-commit`, then `[text("ok")]`. Assert:

- the confirmer was never called (use a confirmer that throws if called);
- the tool message is `rejected: protected path`;
- `.git/hooks/pre-commit` does not exist.

**Verify**: `pnpm vitest run test/run` → all pass.

### Step 4: README and gates

In README "Safety model", change the secret bullet to: ``Secret-looking files (`.env*`, `.envrc`, `.npmrc`, `.netrc`, `.pypirc`, `.pgpass`, keys, certificates, credentials) are unreadable unless you pass `--allow-secrets`. Protected and secret checks ignore letter case and follow symlinks.``

**Verify**: `.claude/verify` → exit 0. `npx fallow --format json` → no findings in changed files.

## Test plan

- `test/tools/confinement.test.ts`: about 18 new cases (Step 1 table, Step 2 symlink cases).
- `test/run/run-loop.test.ts`: 1 integration test (no preview or Confirmation for a symlinked protected path).
- `pnpm test` → all pass.

## Done criteria

- [ ] `.claude/verify` exits 0
- [ ] `grep -n "export async function realPathError\|export function isSecretPath\|export function isProtectedPath" src/tools/confinement.ts` returns 3 lines
- [ ] `grep -n "realPathError" src/run/run-loop.ts` matches, on a line before `buildPreview`
- [ ] `git status` shows only in-scope files changed
- [ ] `plans/README.md` row 008 updated

## STOP conditions

- The excerpts do not match the live files.
- An existing test fails because a legitimate path is now classed as secret. Report the path; do not loosen a pattern on your own.
- `realpath` behaves differently from "Verified behaviour" on your machine (e.g. it keeps the typed case). Report it; Step 1's case-folding still covers that case, but the reviewer must know.

## Maintenance notes

- Two layers now exist on purpose: the sync string check (cheap, runs in `gateToolCall`) and the async real-path check (`resolveGate`). New path-taking tools must be covered by both.
- Plan 009 confines `glob`/`grep` using `isSecretPath`/`isProtectedPath`. Keep those exports.
- Any change to the secret list should update the README bullet and the `it.each` table together.
- A reviewer should verify that `realPathError` runs before `buildPreview`, because the preview reads file contents.
