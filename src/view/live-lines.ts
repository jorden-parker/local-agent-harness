import {
  choiceLabel,
  previewLines,
  streamLines,
  type GatePrompt,
  type Toggles,
} from "./block-lines.js";
import { CHOICE_ORDER } from "../gate/confirmation-keys.js";
import {
  blankLines,
  blankLinesBefore,
  gutterOnlyLine,
  RULE_GUTTER,
  THINKING_MARKER,
  type BlockKind,
  type Line,
  type Span,
} from "./line.js";

export type StreamKind = "thinking" | "reply";

export type Live =
  | { kind: "idle" }
  | { kind: "waiting"; since: number }
  | { kind: "stream"; stream: StreamKind; text: string; committedRows: number }
  | { kind: "gate"; prompt: GatePrompt; selected: number; previewCommitted: boolean };

export interface LiveContext {
  toggles: Toggles;
  lastKind: BlockKind | undefined;
  frame: number;
  now: number;
}

type LiveOf<K extends Live["kind"]> = Extract<Live, { kind: K }>;
type LiveRenderers = { [K in Live["kind"]]: (live: LiveOf<K>, context: LiveContext) => Line[] };

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const LIVE_RENDERERS: LiveRenderers = {
  idle: () => [],
  waiting: waitingLines,
  stream: liveStreamLines,
  gate: (live) => pendingGateLines(live.prompt, live.selected, live.previewCommitted),
};

export function liveLines(live: Live, context: LiveContext): Line[] {
  const render = LIVE_RENDERERS[live.kind] as (live: Live, context: LiveContext) => Line[];
  return render(live, context);
}

export function gateQuestionLines(prompt: GatePrompt): Line[] {
  const question: Line = {
    gutter: [{ text: "◆ ", color: "yellow" }],
    body: [{ text: prompt.question }],
  };
  return [question, ...previewLines(prompt.preview)];
}

export function pendingGateLines(
  prompt: GatePrompt,
  selected: number,
  previewCommitted: boolean,
): Line[] {
  const options = CHOICE_ORDER.map((choice, index) =>
    optionLine(choiceLabel(choice, prompt.toolName), index === selected),
  );
  return [
    ...(previewCommitted ? [] : gateQuestionLines(prompt)),
    gutterOnlyLine({ text: "│", color: "gray" }),
    ...options,
    gutterOnlyLine({ text: "└", color: "yellow" }),
  ];
}

function optionLine(label: string, selected: boolean): Line {
  const option: Span = selected
    ? { text: `● ${label}`, color: "cyan" }
    : { text: `○ ${label}`, color: "gray" };
  return { gutter: [RULE_GUTTER], body: [option] };
}

function waitingLines(live: LiveOf<"waiting">, context: LiveContext): Line[] {
  const frame = SPINNER_FRAMES[context.frame % SPINNER_FRAMES.length] ?? "";
  const waited = Math.floor((context.now - live.since) / 1000);
  const spinner: Line = {
    gutter: [{ text: `${frame} `, color: "magenta" }],
    body: [
      { text: "waiting for model", dim: true },
      { text: ` · ${waited}s`, color: "gray" },
    ],
  };
  return [...blankLines(blankLinesBefore(context.lastKind, "reply")), spinner];
}

function liveStreamLines(live: LiveOf<"stream">, context: LiveContext): Line[] {
  if (live.stream === "thinking" && !context.toggles.thinking)
    return [
      {
        gutter: [THINKING_MARKER],
        body: [{ text: `thinking… ${live.text.length} chars`, dim: true }],
      },
    ];
  return streamLines(live.stream, live.text).slice(live.committedRows);
}
