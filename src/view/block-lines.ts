import type { ConfirmationChoice } from "../run/run-state.js";
import { FINAL_ANSWER_REASON } from "../run/run-loop.js";
import type { ToolOutcome } from "../tools/execute-tool.js";
import { describeToolCall, type ToolCall, type ToolName } from "../tools/tool-call.js";
import {
  INDENT,
  REPLY_MARKER,
  RULE_GUTTER,
  SPACING,
  THINKING_MARKER,
  THINKING_STYLE,
  type Line,
  type Span,
} from "./line.js";
import { inlineMarkdownRows, markdownLines } from "./markdown-lines.js";

export interface Toggles {
  thinking: boolean;
  toolOutput: boolean;
}

export interface GatePrompt {
  question: string;
  preview: string;
  toolName: ToolName;
}

export type Block =
  | {
      kind: "header";
      model: string;
      backendUrl: string;
      logPath: string;
      think: boolean;
      width: number;
    }
  | { kind: "task"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "reply"; text: string }
  | { kind: "tool"; call: ToolCall; outcome: ToolOutcome }
  | { kind: "gate"; prompt: GatePrompt; choice: ConfirmationChoice; previewCommitted: boolean }
  | { kind: "summary"; endReason: string; iterations: number; elapsedMs: number; width: number };

type BlockOf<K extends Block["kind"]> = Extract<Block, { kind: K }>;
type BlockRenderers = {
  [K in Block["kind"]]: (block: BlockOf<K>, toggles: Toggles, columns: number) => Line[];
};

const SILENT_SUCCESS_TOOLS: readonly ToolName[] = ["write", "edit"];
const TOOL_OUTPUT_GUTTER: Span[] = [INDENT, RULE_GUTTER];
const SECONDS_PER_MINUTE = 60;
const DEFAULT_COLUMNS = 80;

const BLOCK_RENDERERS: BlockRenderers = {
  header: headerLines,
  task: (block) => taskLines(block.text),
  thinking: (block, toggles, columns) => thinkingLines(block.text, toggles.thinking, columns),
  reply: (block, _toggles, columns) => markdownLines(REPLY_MARKER, block.text, {}, columns),
  tool: (block, toggles) => toolLines(block, toggles.toolOutput),
  gate: gateLines,
  summary: summaryLines,
};

export function blockLines(block: Block, toggles: Toggles, columns = DEFAULT_COLUMNS): Line[] {
  const render = BLOCK_RENDERERS[block.kind] as (
    block: Block,
    toggles: Toggles,
    columns: number,
  ) => Line[];
  return render(block, toggles, columns);
}

export function choiceLabel(choice: ConfirmationChoice, toolName: ToolName): string {
  if (choice === "y") return "yes";
  if (choice === "n") return "no";
  return `allow every ${toolName} for this run`;
}

export function previewLines(preview: string): Line[] {
  const rows = dropTrailingEmptyRow(dropFileHeaders(preview.split("\n")));
  return rows.map((row) => ({ gutter: [RULE_GUTTER], body: [previewSpan(row)] }));
}

export function streamLines(kind: "thinking" | "reply", text: string, columns: number): Line[] {
  return kind === "thinking"
    ? markdownLines(THINKING_MARKER, text, THINKING_STYLE, columns)
    : markdownLines(REPLY_MARKER, text, {}, columns);
}

function headerLines(block: BlockOf<"header">): Line[] {
  const thinking = block.think ? " · thinking on" : "";
  return [
    {
      gutter: [],
      body: [
        { text: "harness", bold: true },
        { text: ` · ${block.model} via ${block.backendUrl}${thinking}`, dim: true },
      ],
    },
    { gutter: [], body: [{ text: `log ${block.logPath}`, dim: true }] },
    rule(block.width),
  ];
}

function taskLines(text: string): Line[] {
  return inlineMarkdownRows(text, { color: "whiteBright" }).map((body, index) => ({
    gutter: [index === 0 ? { text: "> ", color: "cyan", bold: true } : INDENT],
    body: body.length === 0 ? [{ text: " " }] : body,
    band: true,
  }));
}

function thinkingLines(text: string, shown: boolean, columns: number): Line[] {
  if (shown) return streamLines("thinking", text, columns);
  return [
    {
      gutter: [THINKING_MARKER],
      body: [{ text: `thinking · ${text.length} chars hidden`, dim: true }],
    },
  ];
}

function toolLines(block: BlockOf<"tool">, showOutput: boolean): Line[] {
  const output = showOutput ? toolOutputLines(block.outcome.output) : [];
  return [toolLine(block.call, block.outcome), ...output];
}

function toolLine(call: ToolCall, outcome: ToolOutcome): Line {
  const marker: Span = outcome.ok ? { text: "✓ ", color: "green" } : { text: "✗ ", color: "red" };
  return {
    gutter: [INDENT, marker],
    body: [{ text: describeToolCall(call) }, { text: toolDetail(call, outcome), color: "gray" }],
  };
}

function toolDetail(call: ToolCall, outcome: ToolOutcome): string {
  if (!outcome.ok) return ` → ${outcome.output.split("\n")[0] ?? ""}`;
  if (SILENT_SUCCESS_TOOLS.includes(call.name)) return "";
  return ` · ${countLabel(outputRows(outcome.output).length, "line")}`;
}

function toolOutputLines(output: string): Line[] {
  const rows = outputRows(output);
  const listed = rows
    .slice(0, SPACING.toolOutputCap)
    .map((row): Line => ({ gutter: TOOL_OUTPUT_GUTTER, body: [{ text: row, dim: true }] }));
  const hidden = rows.length - SPACING.toolOutputCap;
  if (hidden <= 0) return listed;
  const more: Line = {
    gutter: TOOL_OUTPUT_GUTTER,
    body: [{ text: `… ${hidden} more lines`, color: "gray" }],
  };
  return [...listed, more];
}

function outputRows(output: string): string[] {
  if (output === "") return [];
  return output.replace(/\n$/, "").split("\n");
}

function gateLines(block: BlockOf<"gate">): Line[] {
  const answered: Line = {
    gutter: [{ text: "◇ ", color: block.choice === "n" ? "red" : "green" }],
    body: [
      { text: block.prompt.question },
      { text: " · ", color: "gray" },
      { text: choiceLabel(block.choice, block.prompt.toolName), color: "cyan" },
    ],
  };
  return block.previewCommitted ? [answered] : [answered, ...previewLines(block.prompt.preview)];
}

function summaryLines(block: BlockOf<"summary">): Line[] {
  const finished = block.endReason === FINAL_ANSWER_REASON;
  const marker: Span = finished ? { text: "✓ ", color: "green" } : { text: "! ", color: "yellow" };
  const detail = `${block.endReason} · ${countLabel(block.iterations, "tool call")} · ${formatDuration(block.elapsedMs)}`;
  return [rule(block.width), { gutter: [marker], body: [{ text: detail }] }];
}

function rule(width: number): Line {
  return { gutter: [], body: [{ text: "─".repeat(width), dim: true }] };
}

function previewSpan(row: string): Span {
  if (row.startsWith("+")) return { text: row, color: "green" };
  if (row.startsWith("-")) return { text: row, color: "red" };
  if (row.startsWith("$ ")) return { text: row, bold: true };
  return { text: row, dim: true };
}

function dropFileHeaders(rows: string[]): string[] {
  const firstHunk = rows.findIndex((row) => row.startsWith("@@"));
  return firstHunk === -1 ? rows : rows.slice(firstHunk);
}

function dropTrailingEmptyRow(rows: string[]): string[] {
  return rows.at(-1) === "" ? rows.slice(0, -1) : rows;
}

function countLabel(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

function formatDuration(elapsedMs: number): string {
  const totalSeconds = Math.round(elapsedMs / 1000);
  if (elapsedMs < SECONDS_PER_MINUTE * 1000) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = String(totalSeconds % SECONDS_PER_MINUTE).padStart(2, "0");
  return `${minutes}m ${seconds}s`;
}
