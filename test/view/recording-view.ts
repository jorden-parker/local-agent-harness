import type { ToolOutcome } from "../../src/tools/execute-tool.js";
import type { ToolCall } from "../../src/tools/tool-call.js";
import type { RunView } from "../../src/view/run-view.js";

export class RecordingView implements RunView {
  readonly events: string[] = [];

  get text(): string {
    return this.events
      .filter((event) => event.startsWith("text:"))
      .map((event) => event.slice("text:".length))
      .join("");
  }

  replyStarted(): void {
    this.events.push("reply-started");
  }

  replyText(text: string): void {
    this.events.push(`text:${text}`);
  }

  thinkingText(text: string): void {
    this.events.push(`thinking:${text}`);
  }

  replyEnded(): void {
    this.events.push("reply-ended");
  }

  confirmationStarted(): void {
    this.events.push("confirmation-started");
  }

  toolFinished(call: ToolCall, outcome: ToolOutcome): void {
    this.events.push(`tool:${call.name}:${outcome.ok ? "ok" : "fail"}`);
  }
}
