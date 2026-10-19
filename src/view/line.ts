export interface Span {
  text: string;
  color?: string;
  dim?: boolean;
  italic?: boolean;
  bold?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  background?: string;
}

export interface Line {
  gutter: Span[];
  body: Span[];
  band?: boolean;
}

export type BlockKind = "header" | "task" | "thinking" | "reply" | "tool" | "gate" | "summary";

export const SPACING = {
  textColumn: 2,
  blankLinesBetweenBlocks: 1,
  footerGap: 1,
  ruleWidth: 60,
  toolOutputCap: 8,
  liveStreamRows: 4,
} as const;

export const INDENT: Span = { text: " ".repeat(SPACING.textColumn) };
export const RULE_GUTTER: Span = { text: "│ ", color: "gray" };
export const THINKING_MARKER: Span = { text: "∴ ", color: "gray" };
export const REPLY_MARKER: Span = { text: "● ", color: "magenta" };
export const THINKING_STYLE = { dim: true, italic: true } as const;
export const BLANK: Line = { gutter: [], body: [{ text: " " }] };

const BLOCKS_THAT_NEST_TOOL_LINES: ReadonlySet<BlockKind> = new Set(["reply", "tool", "gate"]);

export function blankLinesBefore(previous: BlockKind | undefined, next: BlockKind): number {
  if (previous === undefined) return 0;
  if (next === "tool" && BLOCKS_THAT_NEST_TOOL_LINES.has(previous)) return 0;
  return SPACING.blankLinesBetweenBlocks;
}

export function blankLines(count: number): Line[] {
  return Array.from({ length: count }, () => BLANK);
}

export function gutterOnlyLine(span: Span): Line {
  return { gutter: [span], body: [{ text: " " }] };
}

export function splitRows(spans: Span[]): Span[][] {
  const rows: Span[][] = [[]];
  for (const span of spans) {
    span.text.split("\n").forEach((part, index) => {
      if (index > 0) rows.push([]);
      if (part !== "") rows.at(-1)?.push({ ...span, text: part });
    });
  }
  return rows;
}
