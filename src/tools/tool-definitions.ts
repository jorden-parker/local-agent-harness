import type { ToolDefinition } from "../backend/backend.js";

function definition(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
): ToolDefinition {
  return {
    type: "function",
    function: { name, description, parameters: { type: "object", properties, required } },
  };
}

const path = {
  type: "string",
  description: "Path relative to the project root, e.g. src/index.ts",
};

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  definition("read", "Read a text file and return its full contents.", { path }, ["path"]),
  definition(
    "write",
    "Create or overwrite a file with the given content.",
    { path, content: { type: "string" } },
    ["path", "content"],
  ),
  definition(
    "edit",
    "Replace one exact occurrence of `old` with `new` in a file. `old` must match exactly once, including whitespace.",
    { path, old: { type: "string" }, new: { type: "string" } },
    ["path", "old", "new"],
  ),
  definition(
    "glob",
    "List files matching a glob pattern, e.g. src/**/*.ts",
    { pattern: { type: "string" } },
    ["pattern"],
  ),
  definition(
    "grep",
    "Search file contents with a regular expression. Returns path:line: text.",
    {
      pattern: { type: "string", description: "JavaScript regular expression" },
      glob: { type: "string", description: "Optional file glob to limit the search" },
    },
    ["pattern"],
  ),
  definition(
    "shell",
    "Run a shell command in the project root and return its combined output.",
    { command: { type: "string" } },
    ["command"],
  ),
];
