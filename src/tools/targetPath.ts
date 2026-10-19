import { realpath } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

export class ToolError extends Error {}

export async function resolveInsideTarget(
  targetDirectory: string,
  relativePath: string,
): Promise<string> {
  const absolute = resolve(targetDirectory, relativePath);
  const real = await nearestExistingRealPath(absolute);
  if (real !== targetDirectory && !real.startsWith(targetDirectory + sep)) {
    throw new ToolError(`${relativePath} resolves outside the target directory`);
  }
  return absolute;
}

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
