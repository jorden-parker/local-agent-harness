# Plan 009: Confine `glob` and `grep` to the Target Directory and keep `grep` out of secret files

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Prerequisite**: plan 008 is DONE.
> `grep -n "export function isSecretPath\|export function isProtectedPath\|export async function nearestExistingRealPath" src/tools/confinement.ts src/tools/target-path.ts`
> must return 3 lines. If not, STOP.
>
> **Drift check**: `git diff --stat d1ce0d8..HEAD -- src/tools/search-tools.ts test/tools`
> Only plan 008's changes to `test/tools/confinement.test.ts` are expected.
> If `search-tools.ts` changed, compare it with the excerpt below; on a
> mismatch, STOP.

## Status

- **Priority**: P0
- **Effort**: S–M
- **Risk**: LOW (narrows what two read-only tools can see)
- **Depends on**: plans/008-confine-real-paths.md
- **Category**: security
- **Planned at**: commit `d1ce0d8`, 2026-10-19

## Why this matters

`glob` and `grep` run **without a Confirmation**, and today they skip **Confinement** entirely. `confinementError` returns `null` for both, and `search-tools.ts` passes the Model's pattern straight to `fs.glob`. These behaviours were reproduced on 2026-10-19:

- a `glob` pattern starting with `../` listed files outside the Target Directory, and a `grep` with the same `glob` argument printed their contents;
- a `grep` with glob `.env` printed the secret file's contents without `--allow-secrets`;
- a `grep` with glob `linked/*`, where `linked` is a symlinked directory pointing outside the repo, printed contents from outside.

A prompt-injected file in the repo could therefore make the Model read and repeat any file the user can read, with no prompt shown. After this plan, patterns cannot escape the Target Directory, every result is re-checked on its real path, and `grep` never reads secret-pattern or protected files. The Model can still `read` a secret file when `--allow-secrets` is set.

## Current state

### Files and roles

- `src/tools/search-tools.ts` — `globTool` and `grepTool`; both use `matchingPaths`.
- `src/tools/confinement.ts` — `confinementError(call, flags)`; for `glob`/`grep` its `pathError` returns `null`. After plan 008 it also exports `isSecretPath(relative)` and `isProtectedPath(relative)`, both case-insensitive.
- `src/tools/target-path.ts` — after plan 008, exports `nearestExistingRealPath(absolute)`.
- `src/tools/tool-definitions.ts` — `glob` takes `pattern`; `grep` takes `pattern` (a regex) and an optional `glob`.

### Verified behaviour of `fs.glob` here (Node 26, 2026-10-19)

- `**/*` does **not** match dot-files, so `.env` is only reached through an explicit pattern.
- `**/*` does not descend into a symlinked directory, but an explicit `linked/*` does.
- `Dirent.isFile()` is true for a regular file reached through a symlinked directory.

### Excerpt — `src/tools/search-tools.ts` (whole file)

```ts
import { glob, readFile } from "node:fs/promises";
import { relative } from "node:path";
import { stringArgument, type ToolCall } from "./tool-call.js";

const IGNORED = ["**/node_modules/**", "**/.git/**", "**/.harness/**"];
const MAX_MATCHES = 500;

export async function globTool(target: string, call: ToolCall): Promise<string> {
  const paths = await matchingPaths(target, stringArgument(call, "pattern"));
  return paths.length === 0 ? "no files matched" : paths.join("\n");
}

export async function grepTool(target: string, call: ToolCall): Promise<string> {
  const regex = new RegExp(stringArgument(call, "pattern"));
  const scope = typeof call.arguments["glob"] === "string" ? call.arguments["glob"] : "**/*";
  const matches: string[] = [];
  for (const path of await matchingPaths(target, scope)) {
    await collectMatches(target, path, regex, matches);
    if (matches.length >= MAX_MATCHES) break;
  }
  return matches.length === 0 ? "no matches" : matches.slice(0, MAX_MATCHES).join("\n");
}

async function matchingPaths(target: string, pattern: string): Promise<string[]> {
  const paths: string[] = [];
  for await (const path of glob(pattern, { cwd: target, exclude: IGNORED, withFileTypes: true })) {
    if (path.isFile()) paths.push(relative(target, `${path.parentPath}/${path.name}`));
  }
  return paths.sort();
}

async function collectMatches(
  target: string,
  path: string,
  regex: RegExp,
  into: string[],
): Promise<void> {
  const content = await readFile(`${target}/${path}`, "utf8").catch(() => "");
  content.split("\n").forEach((line, index) => {
    if (regex.test(line)) into.push(`${path}:${index + 1}: ${line}`);
  });
}
```

### Conventions to match

- Tool tests live in `test/tools/execute-tool.test.ts` (`mkdtemp` + `realpath` target, `call(name, args)` helper, `symlink` from `node:fs/promises`). Confinement unit tests live in `test/tools/confinement.test.ts`.
- **No code comments of any kind**, including lint suppressions. A hook rejects them.
- Rejection strings are short lower-case phrases (`"path escapes the target directory"`).

## Commands you will need

| Purpose   | Command                      | Expected on success          |
| --------- | ---------------------------- | ---------------------------- |
| Typecheck | `pnpm typecheck`             | exit 0                       |
| Tests     | `pnpm vitest run test/tools` | all pass                     |
| All gates | `.claude/verify`             | exit 0                       |
| Dead code | `npx fallow --format json`   | no findings in changed files |

## Scope

**In scope**:

- `src/tools/confinement.ts`, `test/tools/confinement.test.ts`
- `src/tools/search-tools.ts`
- `test/tools/execute-tool.test.ts`
- `README.md` (one Safety-model bullet)

**Out of scope**:

- Regex time limits for `grep` (a separate, lower-risk finding).
- `read`/`write`/`edit` confinement (plan 008).
- Passing `--allow-secrets` into search tools. `grep` skips secrets unconditionally by design.

## Git workflow

- Branch: `advisor/009-confine-glob-grep`.
- Conventional commit, e.g. `fix: confine glob and grep to the target directory`.
- Do not push or open a PR unless the operator told you to.

## Steps

### Step 1: Reject escaping patterns up front (test first)

Tests in `test/tools/confinement.test.ts`:

- `glob` with `pattern` `../x/*` → `"pattern escapes the target directory"`;
- `glob` with `pattern` `src/../../x` → the same;
- `glob` with `pattern` `/etc/*` → `"absolute patterns are not allowed"`;
- `grep` with `pattern` `foo` and `glob` `../x/*` → `"pattern escapes the target directory"`;
- `grep` with `pattern` `\.\./` (a regex, **not** a path) and no `glob` → `null`;
- `glob` `src/**/*.ts` → `null`.

In `confinementError`, route `glob` to check `pattern`, and `grep` to check `glob` only when it is a string. Implement `globPatternError(pattern): string | null`: an absolute pattern (starts with `/` or `~`) → `"absolute patterns are not allowed"`; any `/`-separated segment equal to `..` → `"pattern escapes the target directory"`; otherwise `null`.

**Verify**: `pnpm vitest run test/tools/confinement.test.ts` → all pass.

### Step 2: Re-check every match on its real path (test first)

Tests in `test/tools/execute-tool.test.ts`. Inside `beforeEach`'s target, create a sibling directory outside the target with a file containing `outside-data`, a symlink `linked -> <that dir>` inside the target, and `.env` containing `TOKEN=x`:

- `grep` `{ pattern: "outside", glob: "linked/*" }` → output `no matches`;
- `glob` `{ pattern: "linked/*" }` → output `no files matched`;
- `grep` `{ pattern: "TOKEN", glob: ".env" }` → output `no matches`;
- `grep` `{ pattern: "TOKEN", glob: ".ENV" }` → output `no matches` (case-insensitive file systems);
- `grep` `{ pattern: "a = 1" }` → still finds `a.ts:1: const a = 1;` (regression).

In `src/tools/search-tools.ts`:

- in `matchingPaths`, after building the relative path, compute `real = await nearestExistingRealPath(join(target, rel))` and `realRel = relative(target, real)`. Keep the path only if `realRel` does not start with `..`, is not absolute, and `!isProtectedPath(realRel)`;
- in `grepTool`, also skip any path where `isSecretPath(realRel)`. Simplest: give `matchingPaths` a second parameter `skipSecrets: boolean` (glob passes `false`, grep passes `true`), and filter there;
- use `join(target, path)` instead of the template string in `collectMatches`.

Keep each function short; extract `isConfinedMatch(target, rel, skipSecrets): Promise<boolean>`.

**Verify**: `pnpm vitest run test/tools` → all pass.

### Step 3: README and gates

Add to README "Safety model" after the secret bullet: `` `glob` and `grep` cannot leave the target directory, and `grep` never reads secret-looking files; use `read` with `--allow-secrets` instead. ``

**Verify**: `.claude/verify` → exit 0. `npx fallow --format json` → no findings in changed files.

## Test plan

- `test/tools/confinement.test.ts`: 6 new cases.
- `test/tools/execute-tool.test.ts`: 5 new cases.
- `pnpm test` → all pass.

## Done criteria

- [ ] `.claude/verify` exits 0
- [ ] `grep -n 'call.name === "glob" || call.name === "grep") return null' src/tools/confinement.ts` returns nothing
- [ ] `grep -n "isSecretPath\|nearestExistingRealPath" src/tools/search-tools.ts` matches
- [ ] `git status` shows only in-scope files changed
- [ ] `plans/README.md` row 009 updated

## STOP conditions

- Plan 008 is not DONE.
- `fs.glob` returns absolute paths, or paths that start with `..`, for patterns that pass Step 1. Report the pattern and output.
- Filtering by real path makes `grep` noticeably slow on this repo (`time` a `grep` over `**/*` before and after; more than 2× slower). Report the timings.

## Maintenance notes

- `glob` still lists secret **file names** (not contents), so the Model can discover that `.env` exists and ask for `--allow-secrets`. That is intentional.
- Brace or extglob patterns that smuggle `..` past a `/` split (e.g. `{..,x}/y`) were not tested. A reviewer should try one and, if it escapes, extend `globPatternError` to reject `..` anywhere in the pattern string. The real-path filter in Step 2 is the backstop either way.
- Any new search-like tool must reuse `matchingPaths`.
