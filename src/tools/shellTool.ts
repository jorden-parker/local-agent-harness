import { spawn } from "node:child_process";
import { ToolError } from "./targetPath.js";
import { stringArgument, type ToolCall } from "./toolCall.js";

const SHELL_TIMEOUT_MS = 120_000;

export function shellTool(target: string, call: ToolCall): Promise<string> {
  const command = stringArgument(call, "command");
  return new Promise((resolvePromise, reject) => {
    const child = spawn("/bin/sh", ["-c", command], {
      cwd: target,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: SHELL_TIMEOUT_MS,
    });
    const output: string[] = [];
    const capture = (chunk: Buffer): void => {
      output.push(chunk.toString());
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    child.on("error", (error) => {
      reject(new ToolError(error.message));
    });
    child.on("close", (code, signal) => {
      if (code === 0) resolvePromise(output.join(""));
      else reject(new ToolError(`exit ${code ?? signal ?? "unknown"}\n${output.join("")}`));
    });
  });
}
