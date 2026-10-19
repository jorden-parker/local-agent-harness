export interface Span {
  text: string;
  color?: string;
  dim?: boolean;
  italic?: boolean;
  bold?: boolean;
}

export interface Line {
  gutter: Span[];
  body: Span[];
  band?: boolean;
}

export interface Toggles {
  thinking: boolean;
  toolOutput: boolean;
}

export type Block =
  | { kind: "task"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "reply"; text: string }
  | { kind: "tool"; ok: boolean; label: string; output: string }
  | { kind: "gate"; question: string; preview: string[]; answer: string; declined: boolean }
  | { kind: "summary"; text: string };

export const SPACING = {
  markerColumn: 0,
  textColumn: 2,
  toolTextColumn: 4,
  blankLinesBetweenBlocks: 1,
  footerGap: 1,
  ruleWidth: 60,
  toolOutputCap: 8,
} as const;

const pad = (width: number): Span => ({ text: " ".repeat(width) });
const INDENT = pad(SPACING.textColumn);
const RULE_GUTTER: Span = { text: "│ ", color: "gray" };
const TOOL_OUTPUT_GUTTER: Span[] = [INDENT, RULE_GUTTER];

export const BLANK: Line = { gutter: [], body: [{ text: " " }] };
export const THINKING_MARKER: Span = { text: "∴ ", color: "gray" };
export const REPLY_MARKER: Span = { text: "● ", color: "magenta" };
export const THINKING_STYLE = { dim: true, italic: true };
const BLOCKS_THAT_NEST_TOOL_LINES: ReadonlySet<Block["kind"]> = new Set(["reply", "tool", "gate"]);

export function blankLinesBefore(previous: Block["kind"] | undefined, next: Block["kind"]): number {
  if (previous === undefined) return 0;
  if (next === "tool" && BLOCKS_THAT_NEST_TOOL_LINES.has(previous)) return 0;
  return SPACING.blankLinesBetweenBlocks;
}

export function markedLines(marker: Span, text: string, style: Omit<Span, "text"> = {}): Line[] {
  return text.split("\n").map((row, index) => ({
    gutter: [index === 0 ? marker : INDENT],
    body: [{ text: row === "" ? " " : row, ...style }],
  }));
}

export function previewLine(row: string): Line {
  if (row.startsWith("+")) return { gutter: [RULE_GUTTER], body: [{ text: row, color: "green" }] };
  if (row.startsWith("-")) return { gutter: [RULE_GUTTER], body: [{ text: row, color: "red" }] };
  if (row.startsWith("$")) return { gutter: [RULE_GUTTER], body: [{ text: row, bold: true }] };
  return { gutter: [RULE_GUTTER], body: [{ text: row, dim: true }] };
}

export function gutterOnlyLine(span: Span): Line {
  return { gutter: [span], body: [{ text: " " }] };
}

type BlockRenderers = {
  [K in Block["kind"]]: (block: Extract<Block, { kind: K }>, toggles: Toggles) => Line[];
};

const BLOCK_RENDERERS: BlockRenderers = {
  task: (block) => [
    {
      gutter: [{ text: "> ", color: "cyan", bold: true }],
      body: [{ text: block.text, color: "whiteBright" }],
      band: true,
    },
  ],
  thinking: (block, toggles) => thinkingLines(block.text, toggles.thinking),
  reply: (block) => markedLines(REPLY_MARKER, block.text),
  tool: (block, toggles) => [
    toolLine(block),
    ...(toggles.toolOutput ? toolOutputLines(block.output) : []),
  ],
  gate: (block) => [answeredGateLine(block), ...block.preview.map(previewLine)],
  summary: (block) => [
    { gutter: [], body: [{ text: "─".repeat(SPACING.ruleWidth), color: "gray" }] },
    { gutter: [{ text: "✓ ", color: "green" }], body: [{ text: block.text }] },
  ],
};

export function blockLines(block: Block, toggles: Toggles): Line[] {
  const renderer = BLOCK_RENDERERS[block.kind] as (block: Block, toggles: Toggles) => Line[];
  return renderer(block, toggles);
}

function thinkingLines(text: string, shown: boolean): Line[] {
  if (shown) return markedLines(THINKING_MARKER, text, THINKING_STYLE);
  return [
    {
      gutter: [THINKING_MARKER],
      body: [{ text: `thinking · ${text.length} chars hidden`, dim: true }],
    },
  ];
}

function answeredGateLine(block: Extract<Block, { kind: "gate" }>): Line {
  return {
    gutter: [{ text: "◇ ", color: block.declined ? "red" : "green" }],
    body: [
      { text: block.question },
      { text: " · ", color: "gray" },
      { text: block.answer, color: "cyan" },
    ],
  };
}

function toolLine(block: Extract<Block, { kind: "tool" }>): Line {
  const marker: Span = block.ok ? { text: "✓ ", color: "green" } : { text: "✗ ", color: "red" };
  return {
    gutter: [INDENT, marker],
    body: [{ text: block.label }, { text: toolDetail(block), color: "gray" }],
  };
}

function toolDetail(block: Extract<Block, { kind: "tool" }>): string {
  if (!block.ok) return ` → ${block.output}`;
  const count = block.output === "" ? 0 : block.output.split("\n").length;
  return count === 0 ? "" : ` · ${count} lines`;
}

function toolOutputLines(output: string): Line[] {
  if (output === "") return [];
  const rows = output.split("\n");
  const shown = rows
    .slice(0, SPACING.toolOutputCap)
    .map((row): Line => ({ gutter: TOOL_OUTPUT_GUTTER, body: [{ text: row, dim: true }] }));
  const hidden = rows.length - SPACING.toolOutputCap;
  if (hidden <= 0) return shown;
  return [
    ...shown,
    { gutter: TOOL_OUTPUT_GUTTER, body: [{ text: `… ${hidden} more lines`, color: "gray" }] },
  ];
}

export function separatedLines(blocks: Block[], toggles: Toggles): Line[] {
  return blocks.flatMap((block, index) => {
    const blanks = blankLinesBefore(blocks[index - 1]?.kind, block.kind);
    return [...Array.from({ length: blanks }, () => BLANK), ...blockLines(block, toggles)];
  });
}
