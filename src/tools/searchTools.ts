import { glob, readFile } from "node:fs/promises";
import { relative } from "node:path";
import { stringArgument, type ToolCall } from "./toolCall.js";

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
