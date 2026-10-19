import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);

export async function prepareTargetDirectory(
  directory: string,
  allowDirty: boolean,
): Promise<string> {
  const target = await realpath(directory);
  const status = await gitStatus(target);
  if (status === null)
    throw new Error(
      `${target} is not a git repository; the harness needs git to make changes reviewable`,
    );
  if (status !== "" && !allowDirty)
    throw new Error("working tree is not clean; commit or stash first, or pass --allow-dirty");
  return target;
}

async function gitStatus(target: string): Promise<string | null> {
  try {
    const { stdout } = await run("git", ["status", "--porcelain"], { cwd: target });
    return stdout.trim();
  } catch {
    return null;
  }
}
