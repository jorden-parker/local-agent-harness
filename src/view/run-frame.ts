import pc from "picocolors";
import { FINAL_ANSWER_REASON, type RunResult } from "../run/run-loop.js";

const MAX_RULE_WIDTH = 60;
const SECONDS_PER_MINUTE = 60;
const BAND_BACKGROUND = "\u001b[48;2;27;33;41m";
const ERASE_TO_LINE_END = "\u001b[K";
const DEFAULT_BACKGROUND = "\u001b[49m";

export interface RunHeader {
  model: string;
  backendUrl: string;
  logPath: string;
  task: string;
  think: boolean;
}

export function ruleWidth(columns: number | undefined): number {
  return Math.min(columns ?? MAX_RULE_WIDTH, MAX_RULE_WIDTH);
}

export function formatRunHeader(header: RunHeader, width: number): string {
  const thinking = header.think ? " · thinking on" : "";
  const lines = [
    `${pc.bold("harness")}${pc.dim(` · ${header.model} via ${header.backendUrl}${thinking}`)}`,
    pc.dim(`log ${header.logPath}`),
    rule(width),
    "",
    taskBand(header.task),
  ];
  return `${lines.join("\n")}\n\n`;
}

function taskBand(task: string): string {
  return task
    .split("\n")
    .map((line, index) =>
      band(`${index === 0 ? pc.bold(pc.cyan(">")) : " "} ${pc.whiteBright(line)}`),
    )
    .join("\n");
}

function band(line: string): string {
  if (!pc.isColorSupported) return line;
  return `${BAND_BACKGROUND}${line}${ERASE_TO_LINE_END}${DEFAULT_BACKGROUND}`;
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
