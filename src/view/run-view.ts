import type { ToolOutcome } from "../tools/execute-tool.js";
import type { ToolCall } from "../tools/tool-call.js";

export interface RunView {
  replyStarted(): void;
  replyText(text: string): void;
  replyEnded(): void;
  toolFinished(call: ToolCall, outcome: ToolOutcome): void;
}
