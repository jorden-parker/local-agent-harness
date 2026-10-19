import type { ToolOutcome } from "../tools/execute-tool.js";
import type { ToolCall } from "../tools/tool-call.js";
import { formatToolLine } from "./tool-line.js";
import { indentStream } from "./stream-indent.js";
import type { RunView } from "./run-view.js";
import { startSpinner } from "./spinner.js";

export class TerminalRunView implements RunView {
  private atLineStart = true;
  private stopSpinner: (() => void) | null = null;

  constructor(
    private readonly write: (text: string) => void,
    private readonly interactive: boolean,
  ) {}

  replyStarted(): void {
    if (this.interactive) this.stopSpinner = startSpinner(this.write);
  }

  replyText(text: string): void {
    this.stopSpinnerIfRunning();
    const chunk = indentStream(text, this.atLineStart);
    if (chunk.text !== "") this.write(chunk.text);
    this.atLineStart = chunk.atLineStart;
  }

  replyEnded(): void {
    this.stopSpinnerIfRunning();
    if (this.atLineStart) return;
    this.write("\n");
    this.atLineStart = true;
  }

  toolFinished(call: ToolCall, outcome: ToolOutcome): void {
    this.replyEnded();
    this.write(`${formatToolLine(call, outcome)}\n`);
  }

  private stopSpinnerIfRunning(): void {
    this.stopSpinner?.();
    this.stopSpinner = null;
  }
}
