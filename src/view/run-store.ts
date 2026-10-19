import type { ConfirmationChoice } from "../run/run-state.js";
import {
  blockLines,
  streamLines,
  type Block,
  type GatePrompt,
  type Toggles,
} from "./block-lines.js";
import { blankLines, blankLinesBefore, type BlockKind, type Line } from "./line.js";
import { gateQuestionLines, pendingGateLines, type Live, type StreamKind } from "./live-lines.js";
import { CHOICE_ORDER } from "../gate/confirmation-keys.js";

export interface CommittedLine {
  key: number;
  line: Line;
}

export interface RunViewState {
  committed: CommittedLine[];
  blocks: Block[];
  live: Live;
  lastKind: BlockKind | undefined;
  toggles: Toggles;
  transcript: { open: boolean; top: number };
  held: Line[];
  finished: boolean;
}

const EXPANDED: Toggles = { thinking: true, toolOutput: true };
const IDLE: Live = { kind: "idle" };

export class RunStore {
  private state: RunViewState;
  private readonly listeners = new Set<() => void>();
  private nextKey = 0;

  constructor(toggles: Toggles = { thinking: true, toolOutput: false }) {
    this.state = {
      committed: [],
      blocks: [],
      live: IDLE,
      lastKind: undefined,
      toggles,
      transcript: { open: false, top: 0 },
      held: [],
      finished: false,
    };
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): RunViewState => this.state;

  addBlock(block: Block): void {
    this.beginBlock(block.kind);
    this.finishBlock(block, 0);
  }

  startWaiting(now: number): void {
    this.update({ live: { kind: "waiting", since: now } });
  }

  streamText(stream: StreamKind, text: string): void {
    const live = this.state.live;
    if (live.kind === "stream" && live.stream === stream) {
      this.extendStream(stream, live.text + text, live.committedRows);
      return;
    }
    const body = text.trimStart();
    if (body === "") return;
    this.endStream();
    this.beginBlock(stream);
    this.extendStream(stream, body, 0);
  }

  endReply(): void {
    this.endStream();
    this.update({ live: IDLE });
  }

  openGate(prompt: GatePrompt, maxLiveRows: number): void {
    this.beginBlock("gate");
    const previewCommitted = pendingGateLines(prompt, 0, false).length > maxLiveRows;
    if (previewCommitted) this.commit(gateQuestionLines(prompt));
    this.update({ live: { kind: "gate", prompt, selected: 0, previewCommitted } });
  }

  moveGateSelection(step: number): void {
    const live = this.state.live;
    if (live.kind !== "gate") return;
    const selected = (live.selected + step + CHOICE_ORDER.length) % CHOICE_ORDER.length;
    this.update({ live: { ...live, selected } });
  }

  answerGate(choice: ConfirmationChoice): void {
    const live = this.state.live;
    if (live.kind !== "gate") return;
    this.update({ live: IDLE });
    this.finishBlock(
      { kind: "gate", prompt: live.prompt, choice, previewCommitted: live.previewCommitted },
      0,
    );
  }

  toggle(name: keyof Toggles): void {
    this.update({ toggles: { ...this.state.toggles, [name]: !this.state.toggles[name] } });
  }

  openTranscript(): void {
    this.update({ transcript: { open: true, top: Number.MAX_SAFE_INTEGER } });
  }

  scrollTranscript(top: number): void {
    this.update({ transcript: { open: true, top: Math.max(0, top) } });
  }

  finish(): void {
    this.update({ live: IDLE, finished: true });
  }

  closeTranscript(): void {
    const held = this.state.held;
    this.update({ transcript: { open: false, top: 0 }, held: [] });
    this.commit(held);
  }

  transcriptLines(): Line[] {
    return this.state.blocks.flatMap((block, index) => [
      ...blankLines(blankLinesBefore(this.state.blocks[index - 1]?.kind, block.kind)),
      ...blockLines(fullBlock(block), EXPANDED),
    ]);
  }

  private extendStream(stream: StreamKind, text: string, committedRows: number): void {
    const committed = this.commitFinishedRows(stream, text, committedRows);
    this.update({ live: { kind: "stream", stream, text, committedRows: committed } });
  }

  private commitFinishedRows(stream: StreamKind, text: string, committedRows: number): number {
    if (!this.isShown(stream)) return committedRows;
    const finished = streamLines(stream, text).slice(committedRows, -1);
    this.commit(finished);
    return committedRows + finished.length;
  }

  private endStream(): void {
    const live = this.state.live;
    if (live.kind !== "stream") return;
    this.update({ live: IDLE });
    const shownRows = this.isShown(live.stream) ? live.committedRows : 0;
    this.finishBlock({ kind: live.stream, text: live.text }, shownRows);
  }

  private isShown(stream: StreamKind): boolean {
    return stream === "reply" || this.state.toggles.thinking;
  }

  private beginBlock(kind: BlockKind): void {
    this.commit(blankLines(blankLinesBefore(this.state.lastKind, kind)));
    this.update({ lastKind: kind });
  }

  private finishBlock(block: Block, alreadyCommittedRows: number): void {
    this.update({ blocks: [...this.state.blocks, block] });
    this.commit(blockLines(block, this.state.toggles).slice(alreadyCommittedRows));
  }

  private commit(lines: Line[]): void {
    if (lines.length === 0) return;
    if (this.state.transcript.open) {
      this.update({ held: [...this.state.held, ...lines] });
      return;
    }
    const entries = lines.map((line) => ({ key: this.nextKey++, line }));
    this.update({ committed: [...this.state.committed, ...entries] });
  }

  private update(next: Partial<RunViewState>): void {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }
}

function fullBlock(block: Block): Block {
  return block.kind === "gate" ? { ...block, previewCommitted: false } : block;
}
