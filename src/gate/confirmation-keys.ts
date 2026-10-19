import type { ConfirmationChoice } from "../run/run-state.js";

export interface Keypress {
  name?: string;
  ctrl?: boolean;
}

export interface KeyResult {
  selected: number;
  choice: ConfirmationChoice | null;
}

export const CHOICE_ORDER: readonly ConfirmationChoice[] = ["y", "n", "a"];

export function readConfirmationKey(selected: number, key: Keypress): KeyResult {
  if (isCancel(key)) return { selected, choice: "n" };
  const direct = CHOICE_ORDER.find((choice) => choice === key.name);
  if (direct !== undefined) return { selected, choice: direct };
  if (key.name === "return") return { selected, choice: CHOICE_ORDER[selected] ?? "n" };
  return { selected: moveSelection(selected, key.name), choice: null };
}

function isCancel(key: Keypress): boolean {
  return key.name === "escape" || (key.ctrl === true && key.name === "c");
}

function moveSelection(selected: number, keyName: string | undefined): number {
  const step = keyName === "down" ? 1 : keyName === "up" ? -1 : 0;
  return (selected + step + CHOICE_ORDER.length) % CHOICE_ORDER.length;
}
