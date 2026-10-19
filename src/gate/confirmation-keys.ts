import type { Key } from "ink";
import type { ConfirmationChoice } from "../run/run-state.js";

export type GateKeyAction =
  | { kind: "answer"; choice: ConfirmationChoice }
  | { kind: "move"; step: number }
  | { kind: "submit" }
  | { kind: "none" };

export const CHOICE_ORDER: readonly ConfirmationChoice[] = ["y", "n", "a"];

export function readGateKey(input: string, key: Key): GateKeyAction {
  if (key.escape || (key.ctrl && input === "c")) return { kind: "answer", choice: "n" };
  if (key.return) return { kind: "submit" };
  if (key.upArrow || key.downArrow) return { kind: "move", step: key.downArrow ? 1 : -1 };
  const choice = CHOICE_ORDER.find((option) => option === input);
  return choice === undefined ? { kind: "none" } : { kind: "answer", choice };
}
