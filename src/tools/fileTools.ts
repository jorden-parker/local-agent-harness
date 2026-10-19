import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { resolveInsideTarget, ToolError } from "./targetPath.js";
import { stringArgument, type ToolCall } from "./toolCall.js";

export async function readTool(target: string, call: ToolCall): Promise<string> {
  const path = await resolveInsideTarget(target, stringArgument(call, "path"));
  return readTextFile(path, stringArgument(call, "path"));
}

export async function writeTool(target: string, call: ToolCall): Promise<string> {
  const path = await resolveInsideTarget(target, stringArgument(call, "path"));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, stringArgument(call, "content"));
  return `wrote ${stringArgument(call, "path")}`;
}

export async function editTool(target: string, call: ToolCall): Promise<string> {
  const relative = stringArgument(call, "path");
  const path = await resolveInsideTarget(target, relative);
  const edited = applyEdit(
    await readTextFile(path, relative),
    stringArgument(call, "old"),
    stringArgument(call, "new"),
  );
  await writeFile(path, edited);
  return `edited ${relative}`;
}

export function applyEdit(content: string, oldText: string, newText: string): string {
  const occurrences = content.split(oldText).length - 1;
  if (occurrences !== 1) {
    throw new ToolError(
      `"old" must appear exactly once in the file; it appears ${occurrences} times`,
    );
  }
  return content.replace(oldText, () => newText);
}

async function readTextFile(path: string, relative: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    throw new ToolError(`cannot read ${relative}: file not found`);
  }
}
