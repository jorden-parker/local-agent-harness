import pc from "picocolors";
import { FINAL_ANSWER_REASON, type RunResult } from "../run/run-loop.js";

const MAX_RULE_WIDTH = 60;
const SECONDS_PER_MINUTE = 60;

export interface RunHeader {
  model: string;
  backendUrl: string;
  logPath: string;
  task: string;
}

export function ruleWidth(columns: number | undefined): number {
  return Math.min(columns ?? MAX_RULE_WIDTH, MAX_RULE_WIDTH);
}

export function formatRunHeader(header: RunHeader, width: number): string {
  const lines = [
    `${pc.bold("harness")}${pc.dim(` · ${header.model} via ${header.backendUrl}`)}`,
    pc.dim(`log ${header.logPath}`),
    rule(width),
    `${pc.cyan(">")} ${header.task}`,
  ];
  return `${lines.join("\n")}\n\n`;
}

export function formatRunSummary(result: RunResult, elapsedMs: number, width: number): string {
  const marker = result.endReason === FINAL_ANSWER_REASON ? pc.green("✓") : pc.yellow("!");
  const toolCalls = countLabel(result.iterations);
  return `\n${rule(width)}\n${marker} ${result.endReason} · ${toolCalls} · ${formatDuration(elapsedMs)}\n`;
}

function rule(width: number): string {
  return pc.dim("─".repeat(width));
}

function countLabel(iterations: number): string {
  return `${iterations} ${iterations === 1 ? "tool call" : "tool calls"}`;
}

function formatDuration(elapsedMs: number): string {
  const totalSeconds = Math.round(elapsedMs / 1000);
  if (elapsedMs < SECONDS_PER_MINUTE * 1000) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = String(totalSeconds % SECONDS_PER_MINUTE).padStart(2, "0");
  return `${minutes}m ${seconds}s`;
}
