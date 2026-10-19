import { isCancel, selectKey } from "@clack/prompts";
import pc from "picocolors";
import type { ConfirmationChoice } from "../run/runState.js";
import { describeToolCall, type ToolCall } from "../tools/toolCall.js";
import type { Confirmer } from "./confirmer.js";

export class TerminalConfirmer implements Confirmer {
  async confirm(call: ToolCall, preview: string): Promise<ConfirmationChoice> {
    if (!process.stdin.isTTY)
      throw new Error("confirmation needs an interactive terminal; rerun with --yolo");
    process.stdout.write(`\n${colourPreview(preview)}\n`);
    const choice = await selectKey<ConfirmationChoice>({
      message: `Allow ${describeToolCall(call)}?`,
      options: [
        { value: "y", label: "yes" },
        { value: "n", label: "no" },
        { value: "a", label: `allow every ${call.name} for this run` },
      ],
    });
    return isCancel(choice) ? "n" : choice;
  }
}

function colourPreview(preview: string): string {
  return preview
    .split("\n")
    .map((line) =>
      line.startsWith("+") ? pc.green(line) : line.startsWith("-") ? pc.red(line) : pc.dim(line),
    )
    .join("\n");
}
