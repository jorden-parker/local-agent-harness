import { describe, expect, it } from "vitest";
import {
  gateToolCall,
  initialRunState,
  recordConfirmation,
  recordToolOutcome,
  type RunState,
} from "../../src/run/runState.js";
import type { ToolCall } from "../../src/tools/toolCall.js";

const read: ToolCall = { id: "1", name: "read", arguments: { path: "a.ts" } };
const edit: ToolCall = { id: "2", name: "edit", arguments: { path: "a.ts" } };
const escape: ToolCall = { id: "3", name: "read", arguments: { path: "../x" } };

const limits = { maxIterations: 50, maxConsecutiveFailures: 3 };
const flags = { yolo: false, allowSecrets: false };

function start(): RunState {
  return initialRunState(limits, flags);
}

describe("gateToolCall", () => {
  it("runs an ungated tool without confirmation", () => {
    const { state, gate } = gateToolCall(start(), read);
    expect(gate).toEqual({ kind: "run" });
    expect(state.iteration).toBe(1);
  });

  it("asks for confirmation on gated tools", () => {
    expect(gateToolCall(start(), edit).gate).toEqual({ kind: "confirm" });
  });

  it("skips confirmation under yolo", () => {
    const yolo = initialRunState(limits, { ...flags, yolo: true });
    expect(gateToolCall(yolo, edit).gate).toEqual({ kind: "run" });
  });

  it("rejects confined calls and counts a failure", () => {
    const { state, gate } = gateToolCall(start(), escape);
    expect(gate).toEqual({ kind: "reject", reason: "path escapes the target directory" });
    expect(state.consecutiveFailures).toBe(1);
  });

  it("ends the run at the iteration cap", () => {
    const nearCap = { ...start(), iteration: 50 };
    const { state } = gateToolCall(nearCap, read);
    expect(state.endReason).toBe("iteration cap reached");
  });

  it("ends the run after three consecutive failures", () => {
    let state = start();
    for (let i = 0; i < 3; i++) state = gateToolCall(state, escape).state;
    expect(state.endReason).toBe("three consecutive tool failures");
  });
});

describe("recordConfirmation", () => {
  it("counts a decline as a failure", () => {
    const { state, proceed } = recordConfirmation(gateToolCall(start(), edit).state, edit, "n");
    expect(proceed).toBe(false);
    expect(state.consecutiveFailures).toBe(1);
  });

  it("remembers allow-for-run per tool", () => {
    const { state } = recordConfirmation(gateToolCall(start(), edit).state, edit, "a");
    expect(gateToolCall(state, edit).gate).toEqual({ kind: "run" });
  });
});

describe("recordToolOutcome", () => {
  it("resets the failure streak on success", () => {
    const failed = gateToolCall(start(), escape).state;
    expect(recordToolOutcome(failed, true).consecutiveFailures).toBe(0);
  });

  it("counts a tool error as a failure", () => {
    expect(recordToolOutcome(start(), false).consecutiveFailures).toBe(1);
  });
});
