import type { Backend, ChatMessage } from "../backend/backend.js";
import type { Confirmer } from "../gate/confirmer.js";
import { buildPreview } from "../gate/preview.js";
import type { RunLog } from "../log/run-log.js";
import { executeTool, type ToolOutcome } from "../tools/execute-tool.js";
import { TOOL_DEFINITIONS } from "../tools/tool-definitions.js";
import type { ToolCall } from "../tools/tool-call.js";
import type { RunView } from "../view/run-view.js";
import { collectReply } from "./collect-reply.js";
import {
  gateToolCall,
  initialRunState,
  recordConfirmation,
  recordToolOutcome,
  type RunFlags,
  type RunLimits,
  type RunState,
} from "./run-state.js";

export interface RunOptions {
  target: string;
  model: string;
  think: boolean;
  numCtx: number;
  timeoutMs: number;
  limits: RunLimits;
  flags: RunFlags;
}

export interface RunDeps {
  backend: Backend;
  confirmer: Confirmer;
  log: RunLog;
  view: RunView;
}

export const FINAL_ANSWER_REASON = "model gave a final answer";

export interface RunResult {
  endReason: string;
  iterations: number;
}

export async function runTask(
  task: string,
  systemPrompt: string,
  options: RunOptions,
  deps: RunDeps,
): Promise<RunResult> {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: task },
  ];
  const signal = AbortSignal.timeout(options.timeoutMs);
  let state = initialRunState(options.limits, options.flags);
  await deps.log.record({ event: "start", task, model: options.model, options });
  try {
    while (state.endReason === null) state = await oneTurn(messages, state, options, deps, signal);
  } catch (error) {
    state = {
      ...state,
      endReason: signal.aborted ? "wall-clock timeout" : `backend error: ${errorMessage(error)}`,
    };
  }
  await deps.log.record({ event: "end", endReason: state.endReason, iterations: state.iteration });
  return { endReason: state.endReason ?? "unknown", iterations: state.iteration };
}

async function oneTurn(
  messages: ChatMessage[],
  state: RunState,
  options: RunOptions,
  deps: RunDeps,
  signal: AbortSignal,
): Promise<RunState> {
  const request = {
    model: options.model,
    messages,
    tools: TOOL_DEFINITIONS,
    think: options.think,
    numCtx: options.numCtx,
  };
  deps.view.replyStarted();
  const reply = await collectReply(deps.backend.chat(request, signal), deps.view);
  deps.view.replyEnded();
  messages.push({ role: "assistant", content: reply.text, tool_calls: reply.calls });
  await deps.log.record({ event: "assistant", text: reply.text, calls: reply.calls });
  if (reply.calls.length === 0) return { ...state, endReason: FINAL_ANSWER_REASON };
  let next = state;
  for (const call of reply.calls) {
    if (next.endReason !== null) break;
    next = await handleToolCall(call, messages, next, options, deps);
  }
  return next;
}

async function handleToolCall(
  call: ToolCall,
  messages: ChatMessage[],
  state: RunState,
  options: RunOptions,
  deps: RunDeps,
): Promise<RunState> {
  const gated = gateToolCall(state, call);
  const { state: afterGate, outcome } = await resolveGate(gated, call, options, deps);
  deps.view.toolFinished(call, outcome);
  messages.push({ role: "tool", content: outcome.output, tool_name: call.name });
  await deps.log.record({ event: "tool", call, ...outcome });
  return afterGate;
}

async function resolveGate(
  gated: ReturnType<typeof gateToolCall>,
  call: ToolCall,
  options: RunOptions,
  deps: RunDeps,
): Promise<{ state: RunState; outcome: ToolOutcome }> {
  if (gated.gate.kind === "reject")
    return { state: gated.state, outcome: { ok: false, output: `rejected: ${gated.gate.reason}` } };
  if (gated.gate.kind === "run") return runTool(gated.state, call, options);
  const preview = await buildPreview(options.target, call);
  deps.view.confirmationStarted();
  const choice = await deps.confirmer.confirm(call, preview);
  const confirmed = recordConfirmation(gated.state, call, choice);
  if (!confirmed.proceed)
    return {
      state: confirmed.state,
      outcome: { ok: false, output: "the user declined this tool call" },
    };
  return runTool(confirmed.state, call, options);
}

async function runTool(
  state: RunState,
  call: ToolCall,
  options: RunOptions,
): Promise<{ state: RunState; outcome: ToolOutcome }> {
  const outcome = await executeTool(options.target, call);
  return { state: recordToolOutcome(state, outcome.ok), outcome };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
