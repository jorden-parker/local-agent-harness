import { editTool, readTool, writeTool } from "./file-tools.js";
import { globTool, grepTool } from "./search-tools.js";
import { shellTool } from "./shell-tool.js";
import { ToolError } from "./target-path.js";
import type { ToolCall, ToolName } from "./tool-call.js";
import { truncateToolOutput } from "./tool-output.js";

type ToolRunner = (target: string, call: ToolCall) => Promise<string>;

const RUNNERS: Record<ToolName, ToolRunner> = {
  read: readTool,
  write: writeTool,
  edit: editTool,
  glob: globTool,
  grep: grepTool,
  shell: shellTool,
};

export interface ToolOutcome {
  ok: boolean;
  output: string;
}

export async function executeTool(target: string, call: ToolCall): Promise<ToolOutcome> {
  try {
    return { ok: true, output: truncateToolOutput(await RUNNERS[call.name](target, call)) };
  } catch (error) {
    if (error instanceof ToolError || error instanceof Error)
      return { ok: false, output: truncateToolOutput(error.message) };
    throw error;
  }
}
