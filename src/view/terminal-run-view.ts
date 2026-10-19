import pc from "picocolors";
import type { ToolOutcome } from "../tools/execute-tool.js";
import type { ToolCall } from "../tools/tool-call.js";
import { formatToolLine } from "./tool-line.js";
import { indentStream } from "./stream-indent.js";
import type { RunView } from "./run-view.js";
import { startSpinner } from "./spinner.js";

type StreamBlock = "thinking" | "reply";
type Block = StreamBlock | "none" | "waiting" | "tools" | "gate" | "answered-gate";

const STREAM_MARKERS: Record<StreamBlock, string> = {
  thinking: `${pc.gray("∴")} `,
  reply: `${pc.magenta("●")} `,
};

const STREAM_STYLES: Record<StreamBlock, (text: string) => string> = {
  thinking: (text) => pc.dim(pc.italic(text)),
  reply: (text) => text,
};

const BLOCKS_WITHOUT_SEPARATOR: ReadonlySet<Block> = new Set(["none", "waiting"]);
const BLOCKS_HOLDING_TOOL_LINES: ReadonlySet<Block> = new Set([
  "waiting",
  "reply",
  "tools",
  "gate",
]);

export class TerminalRunView implements RunView {
  private block: Block = "none";
  private atLineStart = true;
  private stopSpinner: (() => void) | null = null;

  constructor(
    private readonly write: (text: string) => void,
    private readonly interactive: boolean,
  ) {}

  replyStarted(): void {
    this.enterBlock("waiting");
    if (this.interactive) this.stopSpinner = startSpinner(this.write);
  }

  thinkingText(text: string): void {
    this.stream("thinking", text);
  }

  replyText(text: string): void {
    this.stream("reply", text);
  }

  replyEnded(): void {
    this.stopSpinnerIfRunning();
    this.endLine();
  }

  confirmationStarted(): void {
    this.enterBlock("gate");
  }

  toolFinished(call: ToolCall, outcome: ToolOutcome): void {
    this.stopSpinnerIfRunning();
    if (BLOCKS_HOLDING_TOOL_LINES.has(this.block)) this.endLine();
    else this.enterBlock("tools");
    this.write(`${formatToolLine(call, outcome)}\n`);
    this.block = this.block === "gate" ? "answered-gate" : "tools";
  }

  private stream(kind: StreamBlock, text: string): void {
    this.stopSpinnerIfRunning();
    const body = this.block === kind ? text : this.openStreamBlock(kind, text);
    const chunk = indentStream(body, this.atLineStart);
    if (chunk.text !== "") this.write(STREAM_STYLES[kind](chunk.text));
    this.atLineStart = chunk.atLineStart;
  }

  private openStreamBlock(kind: StreamBlock, text: string): string {
    const body = text.trimStart();
    if (body === "") return body;
    this.enterBlock(kind);
    this.write(STREAM_MARKERS[kind]);
    this.atLineStart = false;
    return body;
  }

  private enterBlock(kind: Block): void {
    this.endLine();
    if (!BLOCKS_WITHOUT_SEPARATOR.has(this.block)) this.write("\n");
    this.block = kind;
  }

  private endLine(): void {
    if (this.atLineStart) return;
    this.write("\n");
    this.atLineStart = true;
  }

  private stopSpinnerIfRunning(): void {
    this.stopSpinner?.();
    this.stopSpinner = null;
  }
}
