import { editTool, readTool, writeTool } from "./fileTools.js";
import { globTool, grepTool } from "./searchTools.js";
import { shellTool } from "./shellTool.js";
import { ToolError } from "./targetPath.js";
import type { ToolCall, ToolName } from "./toolCall.js";
import { truncateToolOutput } from "./toolOutput.js";

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
