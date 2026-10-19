export const TOOL_NAMES = ["read", "write", "edit", "glob", "grep", "shell"] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export interface ToolCall {
  id: string;
  name: ToolName;
  arguments: Record<string, unknown>;
}

export function isToolName(name: string): name is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(name);
}

export function stringArgument(call: ToolCall, key: string): string {
  const value = call.arguments[key];
  if (typeof value !== "string") throw new Error(`${call.name} needs a string "${key}" argument`);
  return value;
}

export function describeToolCall(call: ToolCall): string {
  if (call.name === "shell") return `shell: ${String(call.arguments["command"])}`;
  if (call.name === "grep") return `grep: ${String(call.arguments["pattern"])}`;
  return `${call.name}: ${String(call.arguments["path"] ?? call.arguments["pattern"])}`;
}
