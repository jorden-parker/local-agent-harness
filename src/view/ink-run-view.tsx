import { render, type Instance, type Key } from "ink";
import { CHOICE_ORDER, readGateKey, type GateKeyAction } from "../gate/confirmation-keys.js";
import type { Confirmer } from "../gate/confirmer.js";
import type { RunResult } from "../run/run-loop.js";
import type { ConfirmationChoice } from "../run/run-state.js";
import type { ToolOutcome } from "../tools/execute-tool.js";
import { describeToolCall, type ToolCall } from "../tools/tool-call.js";
import type { Toggles } from "./block-lines.js";
import { FOOTER_ROWS } from "./ink/footer.js";
import { RunApp } from "./ink/run-app.js";
import { clampTranscriptTop, transcriptPageRows } from "./ink/transcript.js";
import { SPACING } from "./line.js";
import { RunStore } from "./run-store.js";
import type { RunView } from "./run-view.js";

export interface RunHeader {
  model: string;
  backendUrl: string;
  logPath: string;
  task: string;
  think: boolean;
}

export interface InkRunViewIo {
  stdout: NodeJS.WriteStream;
  stdin: NodeJS.ReadStream;
  interactive: boolean;
  onInterrupt: () => void;
}

const DEFAULT_ROWS = 30;
const DEFAULT_COLUMNS = 80;
const ENTER_ALTERNATE_SCREEN = "\u001b[?1049h\u001b[H";
const LEAVE_ALTERNATE_SCREEN = "\u001b[?1049l";
type GateActionHandlers = {
  [K in GateKeyAction["kind"]]: (action: Extract<GateKeyAction, { kind: K }>) => void;
};

const TOGGLE_KEYS: Readonly<Record<string, keyof Toggles>> = { t: "thinking", o: "toolOutput" };

export class InkRunView implements RunView, Confirmer {
  private readonly store = new RunStore();
  private instance: Instance | null = null;
  private answer: ((choice: ConfirmationChoice) => void) | null = null;

  constructor(private readonly io: InkRunViewIo) {}

  start(header: RunHeader): void {
    this.instance = render(
      <RunApp
        store={this.store}
        interactive={this.io.interactive}
        terminalRows={() => this.terminalRows()}
        terminalColumns={() => this.io.stdout.columns || DEFAULT_COLUMNS}
        onInput={(input, key, rows) => {
          this.handleInput(input, key, rows);
        }}
      />,
      { stdout: this.io.stdout, stdin: this.io.stdin, exitOnCtrlC: false },
    );
    const width = Math.min(this.io.stdout.columns || SPACING.ruleWidth, SPACING.ruleWidth);
    this.store.addBlock({ kind: "header", ...header, width });
    this.store.addBlock({ kind: "task", text: header.task });
  }

  async finish(result: RunResult, elapsedMs: number): Promise<void> {
    const width = Math.min(this.io.stdout.columns || SPACING.ruleWidth, SPACING.ruleWidth);
    this.store.addBlock({ kind: "summary", ...result, elapsedMs, width });
    await this.close();
  }

  async close(): Promise<void> {
    if (this.store.getSnapshot().transcript.open) this.leaveTranscript();
    const instance = this.instance;
    this.instance = null;
    if (instance === null) return;
    this.store.finish();
    await instance.waitUntilRenderFlush();
    instance.unmount();
    await instance.waitUntilExit();
  }

  replyStarted(): void {
    this.store.startWaiting(Date.now());
  }

  thinkingText(text: string): void {
    this.store.streamText("thinking", text);
  }

  replyText(text: string): void {
    this.store.streamText("reply", text);
  }

  replyEnded(): void {
    this.store.endReply();
  }

  confirmationStarted(): void {
    this.store.endReply();
  }

  toolFinished(call: ToolCall, outcome: ToolOutcome): void {
    this.store.addBlock({ kind: "tool", call, outcome });
  }

  confirm(call: ToolCall, preview: string): Promise<ConfirmationChoice> {
    if (!this.io.interactive)
      throw new Error("confirmation needs an interactive terminal; rerun with --yolo");
    const prompt = { question: `Allow ${describeToolCall(call)}?`, preview, toolName: call.name };
    this.store.openGate(prompt, this.terminalRows() - FOOTER_ROWS);
    return new Promise((resolve) => {
      this.answer = resolve;
    });
  }

  private handleInput(input: string, key: Key, rows: number): void {
    const handlers = [
      () => this.handleTranscriptToggleKey(input, key),
      () => this.handleTranscriptKey(input, key, rows),
      () => this.handleGateKey(input, key),
      () => this.handleInterruptKey(input, key),
      () => this.handleToggleKey(input),
    ];
    handlers.some((handle) => handle());
  }

  private handleTranscriptToggleKey(input: string, key: Key): boolean {
    if (!key.ctrl || input !== "o") return false;
    if (this.store.getSnapshot().transcript.open) this.leaveTranscript();
    else this.enterTranscript();
    return true;
  }

  private handleTranscriptKey(input: string, key: Key, rows: number): boolean {
    if (!this.store.getSnapshot().transcript.open) return false;
    if (key.escape || input === "q") {
      this.leaveTranscript();
      return true;
    }
    const page = transcriptPageRows(rows);
    const total = this.store.transcriptLines().length;
    const top = clampTranscriptTop(this.store.getSnapshot().transcript.top, total, page);
    this.store.scrollTranscript(top + transcriptStep(key, page));
    return true;
  }

  private handleGateKey(input: string, key: Key): boolean {
    if (this.answer === null) return false;
    const action = readGateKey(input, key);
    const handlers: GateActionHandlers = {
      move: (move) => {
        this.store.moveGateSelection(move.step);
      },
      answer: (answer) => {
        this.resolveGate(answer.choice);
      },
      submit: () => {
        this.resolveGate(this.selectedChoice());
      },
      none: () => undefined,
    };
    (handlers[action.kind] as (action: GateKeyAction) => void)(action);
    return action.kind !== "none";
  }

  private handleInterruptKey(input: string, key: Key): boolean {
    if (!key.ctrl || input !== "c") return false;
    void this.close().then(this.io.onInterrupt);
    return true;
  }

  private handleToggleKey(input: string): boolean {
    const toggle = TOGGLE_KEYS[input];
    if (toggle === undefined) return false;
    this.store.toggle(toggle);
    return true;
  }

  private selectedChoice(): ConfirmationChoice {
    const live = this.store.getSnapshot().live;
    const selected = live.kind === "gate" ? live.selected : 0;
    return CHOICE_ORDER[selected] ?? "n";
  }

  private resolveGate(choice: ConfirmationChoice): void {
    const answer = this.answer;
    this.answer = null;
    this.store.answerGate(choice);
    answer?.(choice);
  }

  private enterTranscript(): void {
    this.instance?.clear();
    this.io.stdout.write(ENTER_ALTERNATE_SCREEN);
    this.store.openTranscript();
  }

  private leaveTranscript(): void {
    this.instance?.clear();
    this.io.stdout.write(LEAVE_ALTERNATE_SCREEN);
    this.store.closeTranscript();
  }

  private terminalRows(): number {
    return this.io.stdout.rows || DEFAULT_ROWS;
  }
}

function transcriptStep(key: Key, page: number): number {
  const steps: [pressed: boolean, step: number][] = [
    [key.upArrow, -1],
    [key.downArrow, 1],
    [key.pageUp, -page],
    [key.pageDown, page],
  ];
  return steps.find(([pressed]) => pressed)?.[1] ?? 0;
}
