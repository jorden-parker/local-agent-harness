import { Box, render, Static, Text, useInput, useStdout } from "ink";
import { useSyncExternalStore } from "react";
import {
  BLANK,
  blankLinesBefore,
  blockLines,
  gutterOnlyLine,
  markedLines,
  previewLine,
  REPLY_MARKER,
  separatedLines,
  SPACING,
  THINKING_MARKER,
  THINKING_STYLE,
  type Block,
  type Line,
  type Span,
  type Toggles,
} from "./lines.js";
import { SCRIPT, type ScriptStep } from "./script.js";

const args = process.argv.slice(2);
const NAIVE = args.includes("--naive");
const INCREMENTAL = args.includes("--incremental");
const AUTO = args.includes("--auto");
const RATE = Number(args[args.indexOf("--rate") + 1]) || 40;
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const BAND_BACKGROUND = "#1B2129";
const ALL_EXPANDED: Toggles = { thinking: true, toolOutput: true };

type GateStep = Extract<ScriptStep, { kind: "gate" }>;
type Live =
  | { kind: "idle" }
  | { kind: "spinner"; since: number }
  | { kind: "stream"; block: "thinking" | "reply"; text: string; committedRows: number }
  | { kind: "gate"; step: GateStep; selected: number };

interface State {
  staticLines: { key: number; line: Line }[];
  heldLines: Line[];
  blocks: Block[];
  live: Live;
  toggles: Toggles;
  transcript: { open: boolean; top: number };
  tick: number;
}

let state: State = {
  staticLines: [],
  heldLines: [],
  blocks: [],
  live: { kind: "idle" },
  toggles: { thinking: true, toolOutput: false },
  transcript: { open: false, top: 0 },
  tick: 0,
};
const listeners = new Set<() => void>();
const setState = (next: Partial<State>): void => {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
};
const useStore = (): State =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );

let renderCount = 0;
let nextKey = 0;

function commit(lines: Line[]): void {
  if (state.transcript.open) {
    setState({ heldLines: [...state.heldLines, ...lines] });
    return;
  }
  setState({
    staticLines: [...state.staticLines, ...lines.map((line) => ({ key: nextKey++, line }))],
  });
}

function startBlock(kind: Block["kind"]): void {
  const blanks = blankLinesBefore(state.blocks.at(-1)?.kind, kind);
  commit(Array.from({ length: blanks }, () => BLANK));
}

function finishBlock(block: Block, alreadyCommittedRows = 0): void {
  setState({ blocks: [...state.blocks, block] });
  commit(blockLines(block, state.toggles).slice(alreadyCommittedRows));
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function streamRows(kind: "thinking" | "reply", text: string): Line[] {
  return kind === "thinking"
    ? markedLines(THINKING_MARKER, text, THINKING_STYLE)
    : markedLines(REPLY_MARKER, text);
}

const isShown = (kind: "thinking" | "reply"): boolean => kind === "reply" || state.toggles.thinking;

function commitFinishedRows(
  kind: "thinking" | "reply",
  text: string,
  committedRows: number,
): number {
  if (NAIVE || !isShown(kind)) return committedRows;
  const finished = streamRows(kind, text).slice(committedRows, -1);
  commit(finished);
  return committedRows + finished.length;
}

async function streamBlock(kind: "thinking" | "reply", text: string): Promise<void> {
  startBlock(kind);
  const tokens = text.match(/\S+\s*|\s+/g) ?? [];
  let shown = "";
  let committedRows = 0;
  for (const token of tokens) {
    await sleep(1000 / RATE);
    shown += token;
    committedRows = commitFinishedRows(kind, shown, committedRows);
    setState({ live: { kind: "stream", block: kind, text: shown, committedRows } });
  }
  setState({ live: { kind: "idle" } });
  finishBlock({ kind, text }, isShown(kind) ? committedRows : 0);
}

let answerGate: ((answer: string) => void) | null = null;
const gateOptions = (tool: string): string[] => ["yes", "no", `allow every ${tool} for this run`];

async function runGate(step: GateStep): Promise<void> {
  startBlock("gate");
  setState({ live: { kind: "gate", step, selected: 0 } });
  if (AUTO) setTimeout(() => answerGate?.("yes"), 800);
  const answer = await new Promise<string>((resolve) => {
    answerGate = resolve;
  });
  answerGate = null;
  setState({ live: { kind: "idle" } });
  finishBlock({
    kind: "gate",
    question: step.question,
    preview: step.preview,
    answer,
    declined: answer === "no",
  });
}

async function runTool(step: Extract<ScriptStep, { kind: "tool" }>): Promise<void> {
  startBlock("tool");
  finishBlock({ kind: "tool", ok: step.ok, label: step.label, output: step.output });
}

async function runWait(ms: number): Promise<void> {
  setState({ live: { kind: "spinner", since: Date.now() } });
  await sleep(ms);
  setState({ live: { kind: "idle" } });
}

async function runStep(step: ScriptStep): Promise<void> {
  if (step.kind === "wait") return runWait(step.ms);
  if (step.kind === "gate") return runGate(step);
  if (step.kind === "tool") return runTool(step);
  return streamBlock(step.kind, step.text);
}

async function runScript(): Promise<void> {
  const startedAt = Date.now();
  finishBlock({ kind: "task", text: "add a --json flag to the status command" });
  for (const step of SCRIPT) await runStep(step);
  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  startBlock("summary");
  finishBlock({ kind: "summary", text: `model gave a final answer · 5 tool calls · ${elapsed}s` });
}

function spanProps(span: Span) {
  return {
    ...(span.color ? { color: span.color } : {}),
    dimColor: span.dim === true,
    italic: span.italic === true,
    bold: span.bold === true,
  };
}

function Spans({ spans }: { spans: Span[] }) {
  return spans.map((span, index) => (
    <Text key={index} {...spanProps(span)}>
      {span.text}
    </Text>
  ));
}

function LineView({ line, wrap = "wrap" }: { line: Line; wrap?: "wrap" | "truncate-end" }) {
  return (
    <Box
      flexDirection="row"
      width="100%"
      {...(line.band ? { backgroundColor: BAND_BACKGROUND } : {})}
    >
      <Box flexShrink={0}>
        <Text>
          <Spans spans={line.gutter} />
        </Text>
      </Box>
      <Box flexGrow={1}>
        <Text wrap={wrap}>
          <Spans spans={line.body} />
        </Text>
      </Box>
    </Box>
  );
}

function Lines({ lines, wrap }: { lines: Line[]; wrap?: "wrap" | "truncate-end" }) {
  return (
    <Box flexDirection="column">
      {lines.map((line, index) => (
        <LineView key={index} line={line} {...(wrap ? { wrap } : {})} />
      ))}
    </Box>
  );
}

function pendingGateLines(step: GateStep, selected: number): Line[] {
  const options = gateOptions(step.tool).map((label, index): Line => ({
    gutter: [{ text: "│ ", color: "gray" }],
    body: [
      index === selected
        ? { text: `● ${label}`, color: "cyan" }
        : { text: `○ ${label}`, color: "gray" },
    ],
  }));
  return [
    { gutter: [{ text: "◆ ", color: "yellow" }], body: [{ text: step.question }] },
    ...step.preview.map(previewLine),
    gutterOnlyLine({ text: "│", color: "gray" }),
    ...options,
    gutterOnlyLine({ text: "└", color: "yellow" }),
  ];
}

function spinnerLines(since: number, tick: number): Line[] {
  const blanks = blankLinesBefore(state.blocks.at(-1)?.kind, "reply");
  const frame: Line = {
    gutter: [{ text: `${SPINNER_FRAMES[tick % SPINNER_FRAMES.length]} `, color: "magenta" }],
    body: [
      { text: "waiting for model", dim: true },
      { text: ` · ${Math.floor((Date.now() - since) / 1000)}s`, color: "gray" },
    ],
  };
  return [...Array.from({ length: blanks }, () => BLANK), frame];
}

function streamLines(live: Extract<Live, { kind: "stream" }>, toggles: Toggles): Line[] {
  if (live.block === "thinking" && !toggles.thinking)
    return [
      {
        gutter: [THINKING_MARKER],
        body: [{ text: `thinking… ${live.text.length} chars`, dim: true }],
      },
    ];
  return streamRows(live.block, live.text).slice(NAIVE ? 0 : live.committedRows);
}

type LiveRenderers = {
  [K in Live["kind"]]: (live: Extract<Live, { kind: K }>, toggles: Toggles, tick: number) => Line[];
};

const LIVE_RENDERERS: LiveRenderers = {
  spinner: (live, _toggles, tick) => spinnerLines(live.since, tick),
  gate: (live) => pendingGateLines(live.step, live.selected),
  stream: (live, toggles) => streamLines(live, toggles),
  idle: () => [],
};

function liveLines(live: Live, toggles: Toggles, tick: number): Line[] {
  const renderer = LIVE_RENDERERS[live.kind] as (
    live: Live,
    toggles: Toggles,
    tick: number,
  ) => Line[];
  return renderer(live, toggles, tick);
}

type Hint = [key: string, label: string];

const TRANSCRIPT_HINTS: Hint[] = [
  ["↑ ↓ pgup pgdn", "scroll"],
  ["ctrl+o esc", "close"],
];

function toggleHints(toggles: Toggles): Hint[] {
  return [
    ["t", `thinking ${toggles.thinking ? "on" : "off"}`],
    ["o", `tool output ${toggles.toolOutput ? "on" : "off"}`],
    ["ctrl+o", "transcript"],
  ];
}

function gateHints(live: Live): Hint[] {
  if (live.kind !== "gate") return [];
  return [
    ["y", "yes"],
    ["n", "no"],
    ["a", `allow every ${live.step.tool}`],
    ["esc", "counts as no"],
  ];
}

function footerHints(current: State): Hint[] {
  if (current.transcript.open) return TRANSCRIPT_HINTS;
  return [...gateHints(current.live), ...toggleHints(current.toggles)];
}

function Footer({ current }: { current: State }) {
  const mode = [NAIVE ? "naive" : "", INCREMENTAL ? "incremental" : ""].filter(Boolean).join(" ");
  return (
    <Box marginTop={SPACING.footerGap} columnGap={3} flexWrap="wrap">
      {footerHints(current).map(([key, label]) => (
        <Text key={key}>
          <Text color="cyan" bold>
            {key}
          </Text>
          <Text color="gray"> {label}</Text>
        </Text>
      ))}
      <Text color="gray">
        renders {renderCount}
        {mode ? ` · ${mode}` : ""}
      </Text>
    </Box>
  );
}

const FOOTER_ROWS = SPACING.footerGap + 1;
const TRANSCRIPT_HEADER_ROWS = 2;

function transcriptPageSize(rows: number | undefined): number {
  return Math.max(5, (rows ?? 30) - FOOTER_ROWS - TRANSCRIPT_HEADER_ROWS);
}

function Transcript({ top }: { top: number }) {
  const { stdout } = useStdout();
  const page = transcriptPageSize(stdout.rows);
  const all = separatedLines(state.blocks, ALL_EXPANDED);
  const start = Math.min(top, Math.max(0, all.length - page));
  const header: Line = {
    gutter: [],
    body: [
      { text: "transcript", bold: true },
      {
        text: ` · lines ${start + 1}–${Math.min(all.length, start + page)} of ${all.length} · all expanded`,
        color: "gray",
      },
    ],
  };
  return (
    <Box flexDirection="column" height={page + TRANSCRIPT_HEADER_ROWS}>
      <Lines lines={[header, BLANK]} />
      <Lines lines={all.slice(start, start + page)} wrap="truncate-end" />
    </Box>
  );
}

let instance: ReturnType<typeof render> | null = null;

function openTranscript(): void {
  instance?.clear();
  process.stdout.write("\u001b[?1049h\u001b[H");
  setState({ transcript: { open: true, top: Number.MAX_SAFE_INTEGER } });
}

function closeTranscript(): void {
  instance?.clear();
  process.stdout.write("\u001b[?1049l");
  const held = state.heldLines;
  setState({ transcript: { open: false, top: 0 }, heldLines: [] });
  commit(held);
}

function scrollTranscript(move: number, rows: number | undefined): void {
  const page = transcriptPageSize(rows);
  const total = separatedLines(state.blocks, ALL_EXPANDED).length;
  const top = Math.min(state.transcript.top, Math.max(0, total - page));
  setState({ transcript: { open: true, top: Math.max(0, top + move) } });
}

type Key = Parameters<Parameters<typeof useInput>[0]>[1];

const GATE_ANSWER_INDEX: Record<string, number> = { y: 0, n: 1, a: 2 };

function answerIndex(input: string, key: Key, selected: number): number | undefined {
  if (key.escape) return GATE_ANSWER_INDEX["n"];
  if (key.return) return selected;
  return GATE_ANSWER_INDEX[input];
}

function selectionStep(key: Key): number {
  if (key.downArrow) return 1;
  return key.upArrow ? 2 : 0;
}

function answerGateAt(live: Extract<Live, { kind: "gate" }>, index: number): void {
  answerGate?.(gateOptions(live.step.tool)[index] ?? "no");
}

function handleGateKey(input: string, key: Key, live: Extract<Live, { kind: "gate" }>): void {
  const index = answerIndex(input, key, live.selected);
  if (index !== undefined) return answerGateAt(live, index);
  setState({ live: { ...live, selected: (live.selected + selectionStep(key)) % 3 } });
}

function transcriptMove(key: Key, rows: number | undefined): number {
  const page = transcriptPageSize(rows);
  const moves: [boolean, number][] = [
    [key.upArrow, -1],
    [key.downArrow, 1],
    [key.pageUp, -page],
    [key.pageDown, page],
  ];
  return moves.find(([pressed]) => pressed)?.[1] ?? 0;
}

function handleTranscriptKey(input: string, key: Key, rows: number | undefined): void {
  if (key.escape || input === "q") return closeTranscript();
  scrollTranscript(transcriptMove(key, rows), rows);
}

const TOGGLE_KEYS: Record<string, keyof Toggles> = { t: "thinking", o: "toolOutput" };

function toggleTranscript(): void {
  if (state.transcript.open) closeTranscript();
  else openTranscript();
}

function handleRunKey(input: string, key: Key): void {
  const toggle = TOGGLE_KEYS[input];
  if (toggle) return setState({ toggles: { ...state.toggles, [toggle]: !state.toggles[toggle] } });
  if (state.live.kind === "gate") handleGateKey(input, key, state.live);
}

function handleKey(input: string, key: Key, rows: number | undefined): void {
  if (key.ctrl && input === "o") return toggleTranscript();
  if (state.transcript.open) return handleTranscriptKey(input, key, rows);
  handleRunKey(input, key);
}

function App() {
  const current = useStore();
  const { stdout } = useStdout();
  useInput((input, key) => handleKey(input, key, stdout.rows));

  return (
    <>
      <Static items={current.staticLines}>
        {(item) => <LineView key={item.key} line={item.line} />}
      </Static>
      {current.transcript.open ? (
        <Transcript top={current.transcript.top} />
      ) : (
        <Lines lines={liveLines(current.live, current.toggles, current.tick)} />
      )}
      <Footer current={current} />
    </>
  );
}

setInterval(() => setState({ tick: state.tick + 1 }), 80);
instance = render(<App />, {
  incrementalRendering: INCREMENTAL,
  onRender: () => {
    renderCount += 1;
  },
});
await runScript();
if (AUTO) {
  await sleep(300);
  instance.unmount();
  process.exit(0);
}
