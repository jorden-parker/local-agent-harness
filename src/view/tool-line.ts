import pc from "picocolors";
import type { ToolOutcome } from "../tools/execute-tool.js";
import { describeToolCall, type ToolCall, type ToolName } from "../tools/tool-call.js";

const SILENT_SUCCESS_TOOLS: readonly ToolName[] = ["write", "edit"];

export function formatToolLine(call: ToolCall, outcome: ToolOutcome): string {
  const description = describeToolCall(call);
  if (!outcome.ok)
    return `  ${pc.red("✗")} ${description} ${pc.dim(`→ ${firstLine(outcome.output)}`)}`;
  return `  ${pc.green("✓")} ${description}${successDetail(call, outcome.output)}`;
}

function successDetail(call: ToolCall, output: string): string {
  if (SILENT_SUCCESS_TOOLS.includes(call.name)) return "";
  return pc.dim(` · ${countLabel(countLines(output))}`);
}

function countLines(output: string): number {
  if (output === "") return 0;
  return output.replace(/\n$/, "").split("\n").length;
}

function countLabel(count: number): string {
  return `${count} ${count === 1 ? "line" : "lines"}`;
}

function firstLine(output: string): string {
  return output.split("\n")[0] ?? "";
}
