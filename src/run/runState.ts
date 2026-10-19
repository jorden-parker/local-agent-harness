import { confinementError, type ConfinementFlags } from "../tools/confinement.js";
import type { ToolCall, ToolName } from "../tools/toolCall.js";

export interface RunLimits {
  maxIterations: number;
  maxConsecutiveFailures: number;
}

export interface RunFlags extends ConfinementFlags {
  yolo: boolean;
}

export interface RunState {
  limits: RunLimits;
  flags: RunFlags;
  iteration: number;
  consecutiveFailures: number;
  allowedForRun: ToolName[];
  endReason: string | null;
}

export type Gate = { kind: "run" } | { kind: "confirm" } | { kind: "reject"; reason: string };

export type ConfirmationChoice = "y" | "n" | "a";

const GATED_TOOLS: ReadonlySet<ToolName> = new Set(["write", "edit", "shell"]);

export function initialRunState(limits: RunLimits, flags: RunFlags): RunState {
  return {
    limits,
    flags,
    iteration: 0,
    consecutiveFailures: 0,
    allowedForRun: [],
    endReason: null,
  };
}

export function gateToolCall(state: RunState, call: ToolCall): { state: RunState; gate: Gate } {
  const iteration = state.iteration + 1;
  if (iteration > state.limits.maxIterations) {
    return {
      state: { ...state, iteration, endReason: "iteration cap reached" },
      gate: { kind: "reject", reason: "iteration cap reached" },
    };
  }
  const counted = { ...state, iteration };
  const reason = confinementError(call, state.flags);
  if (reason !== null)
    return { state: recordToolOutcome(counted, false), gate: { kind: "reject", reason } };
  return {
    state: counted,
    gate: { kind: needsConfirmation(counted, call.name) ? "confirm" : "run" },
  };
}

function needsConfirmation(state: RunState, tool: ToolName): boolean {
  return GATED_TOOLS.has(tool) && !state.flags.yolo && !state.allowedForRun.includes(tool);
}

export function recordConfirmation(
  state: RunState,
  call: ToolCall,
  choice: ConfirmationChoice,
): { state: RunState; proceed: boolean } {
  if (choice === "n") return { state: recordToolOutcome(state, false), proceed: false };
  const allowedForRun = choice === "a" ? [...state.allowedForRun, call.name] : state.allowedForRun;
  return { state: { ...state, allowedForRun }, proceed: true };
}

export function recordToolOutcome(state: RunState, succeeded: boolean): RunState {
  if (succeeded) return { ...state, consecutiveFailures: 0 };
  const consecutiveFailures = state.consecutiveFailures + 1;
  const exhausted = consecutiveFailures >= state.limits.maxConsecutiveFailures;
  return {
    ...state,
    consecutiveFailures,
    endReason: exhausted ? "three consecutive tool failures" : state.endReason,
  };
}
