import { createTwoFilesPatch } from "diff";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { applyEdit } from "../tools/fileTools.js";
import { stringArgument, type ToolCall } from "../tools/toolCall.js";

const MAX_PREVIEW_LINES = 80;

export async function buildPreview(target: string, call: ToolCall): Promise<string> {
  if (call.name === "shell") return `$ ${stringArgument(call, "command")}`;
  if (call.name === "write" || call.name === "edit") return capLines(await filePatch(target, call));
  return "";
}

async function filePatch(target: string, call: ToolCall): Promise<string> {
  const path = stringArgument(call, "path");
  const before = await readFile(resolve(target, path), "utf8").catch(() => "");
  const after = proposedContent(call, before);
  if (after === null) return "edit cannot be applied: see tool result";
  return createTwoFilesPatch(path, path, before, after, "", "", { context: 3 });
}

function proposedContent(call: ToolCall, before: string): string | null {
  if (call.name === "write") return stringArgument(call, "content");
  try {
    return applyEdit(before, stringArgument(call, "old"), stringArgument(call, "new"));
  } catch {
    return null;
  }
}

function capLines(text: string): string {
  const lines = text.split("\n");
  if (lines.length <= MAX_PREVIEW_LINES) return text;
  return `${lines.slice(0, MAX_PREVIEW_LINES).join("\n")}\n... ${lines.length - MAX_PREVIEW_LINES} more lines`;
}
