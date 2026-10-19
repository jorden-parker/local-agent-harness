import { emitKeypressEvents } from "node:readline";
import type { ConfirmationChoice } from "../run/run-state.js";
import { describeToolCall, type ToolCall } from "../tools/tool-call.js";
import { countRows } from "../view/terminal-rows.js";
import {
  formatAnsweredConfirmation,
  formatPendingConfirmation,
  type ConfirmationPrompt,
} from "./confirmation-frame.js";
import { readConfirmationKey, type Keypress } from "./confirmation-keys.js";
import type { Confirmer } from "./confirmer.js";

type KeypressListener = (input: string | undefined, key: Keypress | undefined) => void;

const HIDE_CURSOR = "\u001b[?25l";
const SHOW_CURSOR = "\u001b[?25h";
const CLEAR_TO_SCREEN_END = "\u001b[J";
const DEFAULT_COLUMNS = 80;

export class TerminalConfirmer implements Confirmer {
  confirm(call: ToolCall, preview: string): Promise<ConfirmationChoice> {
    if (!process.stdin.isTTY)
      throw new Error("confirmation needs an interactive terminal; rerun with --yolo");
    return askForChoice({
      question: `Allow ${describeToolCall(call)}?`,
      preview,
      toolName: call.name,
    });
  }
}

function askForChoice(prompt: ConfirmationPrompt): Promise<ConfirmationChoice> {
  return new Promise((resolve) => {
    let selected = 0;
    let shown = replaceFrame("", formatPendingConfirmation(prompt, selected));
    const onKeypress: KeypressListener = (_input, key) => {
      const result = readConfirmationKey(selected, key ?? {});
      selected = result.selected;
      if (result.choice === null) {
        shown = replaceFrame(shown, formatPendingConfirmation(prompt, selected));
        return;
      }
      replaceFrame(shown, formatAnsweredConfirmation(prompt, result.choice));
      stopListening(onKeypress);
      resolve(result.choice);
    };
    startListening(onKeypress);
  });
}

function replaceFrame(previous: string, next: string): string {
  process.stdout.write(`${eraseRows(previous)}${next}`);
  return next;
}

function eraseRows(previous: string): string {
  if (previous === "") return "";
  const rows = countRows(previous, process.stdout.columns || DEFAULT_COLUMNS);
  return `\u001b[${rows}F${CLEAR_TO_SCREEN_END}`;
}

function startListening(onKeypress: KeypressListener): void {
  process.stdout.write(HIDE_CURSOR);
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("keypress", onKeypress);
}

function stopListening(onKeypress: KeypressListener): void {
  process.stdin.off("keypress", onKeypress);
  process.stdin.setRawMode(false);
  process.stdin.pause();
  process.stdout.write(SHOW_CURSOR);
}
