import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { glob } from "node:fs/promises";

const run = promisify(execFile);
const MAX_TREE_ENTRIES = 200;

export async function buildSystemPrompt(target: string): Promise<string> {
  const [status, tree] = await Promise.all([gitStatus(target), fileTree(target)]);
  return [
    "You are a careful coding agent working inside a single git repository.",
    "Use the tools to inspect and change files. Paths are relative to the project root.",
    "Prefer small, verified changes: read before you edit, run tests after you change code.",
    "Some tool calls need the user's approval; if one is declined, explain and try another approach.",
    "When the task is complete, reply with a short summary and no tool call.",
    "",
    `Project root: ${target}`,
    `git status --short:\n${status || "(clean)"}`,
    `Files (depth 2, max ${MAX_TREE_ENTRIES}):\n${tree}`,
  ].join("\n");
}

async function gitStatus(target: string): Promise<string> {
  const { stdout } = await run("git", ["status", "--short"], { cwd: target });
  return stdout.trim();
}

async function fileTree(target: string): Promise<string> {
  const entries: string[] = [];
  for await (const entry of glob("{*,*/*}", {
    cwd: target,
    exclude: ["node_modules", ".git", ".harness"],
  })) {
    if (entries.push(entry) >= MAX_TREE_ENTRIES) break;
  }
  return entries.sort().join("\n");
}
