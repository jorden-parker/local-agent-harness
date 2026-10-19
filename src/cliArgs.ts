import { parseArgs } from "node:util";
import type { RunOptions } from "./run/runLoop.js";

export interface CliArgs {
  task: string;
  model: string;
  backend: string;
  allowDirty: boolean;
  runOptions: Omit<RunOptions, "target" | "model">;
}

const USAGE = `usage: harness "task" [--model qwen3:8b] [--backend http://localhost:11434] [--yolo] [--allow-secrets] [--allow-dirty] [--think] [--num-ctx 32768] [--max-iterations 50] [--timeout-minutes 20]`;

export function parseCliArgs(argv: string[]): CliArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      model: { type: "string", default: "qwen3:8b" },
      backend: { type: "string", default: "http://localhost:11434" },
      yolo: { type: "boolean", default: false },
      "allow-secrets": { type: "boolean", default: false },
      "allow-dirty": { type: "boolean", default: false },
      think: { type: "boolean", default: false },
      "num-ctx": { type: "string", default: "32768" },
      "max-iterations": { type: "string", default: "50" },
      "timeout-minutes": { type: "string", default: "20" },
    },
  });
  const task = positionals.join(" ").trim();
  if (task === "") throw new Error(USAGE);
  return {
    task,
    model: values.model,
    backend: values.backend,
    allowDirty: values["allow-dirty"],
    runOptions: {
      think: values.think,
      numCtx: positiveInteger(values["num-ctx"], "--num-ctx"),
      timeoutMs: positiveInteger(values["timeout-minutes"], "--timeout-minutes") * 60_000,
      limits: {
        maxIterations: positiveInteger(values["max-iterations"], "--max-iterations"),
        maxConsecutiveFailures: 3,
      },
      flags: { yolo: values.yolo, allowSecrets: values["allow-secrets"] },
    },
  };
}

function positiveInteger(raw: string, flag: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${flag} must be a positive integer`);
  return value;
}
