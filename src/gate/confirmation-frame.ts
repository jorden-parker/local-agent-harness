import pc from "picocolors";
import type { ConfirmationChoice } from "../run/run-state.js";
import type { ToolName } from "../tools/tool-call.js";
import { renderPreview } from "../view/preview-render.js";
import { CHOICE_ORDER } from "./confirmation-keys.js";

export interface ConfirmationPrompt {
  question: string;
  preview: string;
  toolName: ToolName;
}

const GUTTER = pc.gray("│");

export function formatPendingConfirmation(prompt: ConfirmationPrompt, selected: number): string {
  const options = CHOICE_ORDER.map((choice, index) =>
    formatOption(choiceLabel(choice, prompt.toolName), index === selected),
  );
  const lines = [
    `${pc.yellow("◆")} ${prompt.question}`,
    ...previewLines(prompt.preview),
    GUTTER,
    ...options,
    pc.yellow("└"),
    keyHints(prompt.toolName),
  ];
  return `${lines.join("\n")}\n`;
}

export function formatAnsweredConfirmation(
  prompt: ConfirmationPrompt,
  choice: ConfirmationChoice,
): string {
  const marker = choice === "n" ? pc.red("◇") : pc.green("◇");
  const answer = pc.cyan(choiceLabel(choice, prompt.toolName));
  const lines = [
    `${marker} ${prompt.question}${pc.gray(" · ")}${answer}`,
    ...previewLines(prompt.preview),
  ];
  return `${lines.join("\n")}\n`;
}

function previewLines(preview: string): string[] {
  return preview === "" ? [] : [renderPreview(preview)];
}

function formatOption(label: string, selected: boolean): string {
  const option = selected ? `${pc.cyan("●")} ${pc.whiteBright(label)}` : pc.gray(`○ ${label}`);
  return `${GUTTER} ${option}`;
}

function choiceLabel(choice: ConfirmationChoice, toolName: ToolName): string {
  if (choice === "y") return "yes";
  if (choice === "n") return "no";
  return `allow every ${toolName} for this run`;
}

function keyHints(toolName: ToolName): string {
  const hints: [key: string, label: string][] = [
    ["y", "yes"],
    ["n", "no"],
    ["a", `allow every ${toolName}`],
    ["esc", "counts as no"],
  ];
  return hints.map(([key, label]) => `${pc.bold(pc.cyan(key))} ${pc.gray(label)}`).join("   ");
}
