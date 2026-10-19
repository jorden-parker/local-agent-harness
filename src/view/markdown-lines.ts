import { Lexer, type Token, type Tokens } from "marked";
import { CODE_COLOURS, highlightCode } from "./code-highlight.js";
import { INDENT, SPACING, splitRows, type Line, type Span } from "./line.js";
import { textWidth, wrapLine } from "./wrap-line.js";

type SpanStyle = Omit<Span, "text">;
type Align = "left" | "right" | "center" | null;

interface RenderContext {
  style: SpanStyle;
  width: number;
}

type InlineRenderer = (token: Token, style: SpanStyle) => Span[];
type BlockRenderer = (token: Token, context: RenderContext) => Line[];

const DEFAULT_COLUMNS = 80;
const MIN_CELL_WIDTH = 3;
const CODE_PADDING: Span = { text: " " };
const CODE_BACKGROUND = "#1B2129";
const CODE_CHIP: SpanStyle = { color: "#E6C07B", background: CODE_BACKGROUND };
const LINK: SpanStyle = { color: "#7FB4F2", underline: true };
const MUTED: SpanStyle = { color: "gray" };
const QUOTE_GUTTER: Span = { text: "│ ", color: "gray" };
const BULLET = "• ";
const SKIPPED_BLOCKS: ReadonlySet<string> = new Set(["space", "def", "checkbox"]);
const BLANK_ROW: Line = { gutter: [], body: [{ text: " " }] };
const TABLE_EDGES = {
  top: ["╭", "┬", "╮"],
  middle: ["├", "┼", "┤"],
  bottom: ["╰", "┴", "╯"],
} as const;

const INLINE_RENDERERS: Readonly<Record<string, InlineRenderer>> = {
  text: (token, style) => textSpans(token, style),
  strong: (token, style) => inlineSpans(children(token), { ...style, bold: true }),
  em: (token, style) => inlineSpans(children(token), { ...style, italic: true }),
  del: (token, style) => inlineSpans(children(token), { ...style, strikethrough: true }),
  codespan: (token, style) => [{ ...style, ...CODE_CHIP, text: textOf(token) }],
  link: (token, style) => linkSpans(token as Tokens.Link, style),
  image: (token, style) => [{ ...style, ...MUTED, text: `[image: ${textOf(token)}]` }],
  br: (_token, style) => [{ ...style, text: "\n" }],
  escape: (token, style) => [{ ...style, text: textOf(token) }],
  html: (token, style) => [{ ...style, dim: true, text: textOf(token) }],
  checkbox: () => [],
};

const BLOCK_RENDERERS: Readonly<Record<string, BlockRenderer>> = {
  paragraph: (token, context) => inlineLines(token, context.style),
  text: (token, context) => inlineLines(token, context.style),
  heading: (token, context) =>
    inlineLines(token, headingStyle(token as Tokens.Heading, context.style)),
  code: (token, context) => codeLines(token as Tokens.Code, context),
  blockquote: (token, context) => quoteLines(children(token), context),
  list: (token, context) => listLines(token as Tokens.List, context),
  table: (token, context) => tableLines(token as Tokens.Table, context),
  hr: (_token, context) => [
    { gutter: [], body: [{ ...context.style, ...MUTED, text: "─".repeat(SPACING.ruleWidth) }] },
  ],
  html: (token, context) =>
    rowsToLines(splitRows([{ ...context.style, dim: true, text: textOf(token) }])),
};

export function markdownLines(
  marker: Span,
  text: string,
  style: SpanStyle = {},
  columns: number = DEFAULT_COLUMNS,
): Line[] {
  const context = { style, width: columns - SPACING.textColumn };
  const lines = joinBlocks(blockGroups(new Lexer().lex(text), context), true);
  return lines.map((line, index) => prefixed(line, [index === 0 ? marker : INDENT]));
}

export function inlineMarkdownRows(text: string, style: SpanStyle = {}): Span[][] {
  return splitRows(inlineSpans(Lexer.lexInline(text), style));
}

export function openTableRows(text: string): number | null {
  const blocks = new Lexer().lex(text).filter((token) => !SKIPPED_BLOCKS.has(token.type));
  const last = blocks.at(-1);
  return last?.type === "table" ? (last as Tokens.Table).rows.length + 1 : null;
}

export function settledMarkdownRows(text: string, columns: number = DEFAULT_COLUMNS): number {
  const context = { style: {}, width: columns - SPACING.textColumn };
  const groups = blockGroups(new Lexer().lex(text), context);
  return groups.slice(0, -1).reduce((rows, group) => rows + group.length + 1, 0);
}

function blockGroups(tokens: Token[], context: RenderContext): Line[][] {
  return tokens
    .filter((token) => !SKIPPED_BLOCKS.has(token.type))
    .map((token) => renderBlock(token, context))
    .filter((lines) => lines.length > 0);
}

function renderBlock(token: Token, context: RenderContext): Line[] {
  const render = BLOCK_RENDERERS[token.type];
  if (render !== undefined) return render(token, context);
  return rowsToLines(splitRows([{ ...context.style, text: token.raw }]));
}

function joinBlocks(groups: Line[][], separated: boolean): Line[] {
  return groups.flatMap((group, index) => (separated && index > 0 ? [BLANK_ROW, ...group] : group));
}

function inlineLines(token: Token, style: SpanStyle): Line[] {
  return rowsToLines(splitRows(textSpans(token, style)));
}

function headingStyle(token: Tokens.Heading, style: SpanStyle): SpanStyle {
  const strong = token.depth <= 2 ? { color: "whiteBright" } : {};
  return { ...style, ...strong, bold: true, underline: token.depth === 1 };
}

function codeLines(token: Tokens.Code, context: RenderContext): Line[] {
  const language = token.lang === undefined || token.lang === "" ? undefined : token.lang;
  const innerWidth = Math.max(1, context.width - 2);
  const label: Span[][] =
    language === undefined ? [] : [[{ text: language, color: CODE_COLOURS.comment }]];
  const code = highlightCode(token.text, language, context.style).flatMap((row) =>
    wrapLine({ gutter: [], body: row }, innerWidth).map((line) => line.body),
  );
  return [...label, ...code].map((row) => ({ gutter: [], body: panelRow(row, innerWidth) }));
}

function panelRow(row: Span[], width: number): Span[] {
  const padded = [CODE_PADDING, ...row, { text: " ".repeat(width - spansWidth(row) + 1) }];
  return padded.map((span) => ({ ...span, background: CODE_BACKGROUND }));
}

function quoteLines(tokens: Token[], context: RenderContext): Line[] {
  const inner = { ...context, width: context.width - textWidth(QUOTE_GUTTER.text) };
  return joinBlocks(blockGroups(tokens, inner), true).map((line) => prefixed(line, [QUOTE_GUTTER]));
}

function listLines(token: Tokens.List, context: RenderContext): Line[] {
  const markers = token.items.map((_item, index) =>
    token.ordered ? `${listStart(token) + index}. ` : BULLET,
  );
  const width = Math.max(...markers.map(textWidth));
  const inner = { ...context, width: context.width - width };
  return token.items.flatMap((item, index) => {
    const content = itemContent(item, inner);
    const marker = (markers[index] ?? BULLET).padStart(width);
    return content.map((line, row) =>
      prefixed(line, [{ text: row === 0 ? marker : " ".repeat(width) }]),
    );
  });
}

function listStart(token: Tokens.List): number {
  return typeof token.start === "number" ? token.start : 1;
}

function itemContent(item: Tokens.ListItem, context: RenderContext): Line[] {
  const lines = joinBlocks(blockGroups(item.tokens, context), item.loose);
  const [first, ...rest] = lines.length > 0 ? lines : [BLANK_ROW];
  if (!item.task || first === undefined) return [first ?? BLANK_ROW, ...rest];
  const box: Span = { ...context.style, ...MUTED, text: item.checked === true ? "[x] " : "[ ] " };
  return [{ ...first, body: [box, ...first.body] }, ...rest];
}

function tableLines(token: Tokens.Table, context: RenderContext): Line[] {
  const header = token.header.map((cell) =>
    cellSpans(cell.tokens, { ...context.style, bold: true }),
  );
  const rows = token.rows.map((row) => row.map((cell) => cellSpans(cell.tokens, context.style)));
  const natural = header.map((_cell, column) =>
    Math.max(...[header, ...rows].map((row) => spansWidth(row[column] ?? []))),
  );
  const widths = fitWidths(natural, context.width);
  const render = (row: Span[][]): Line[] => tableRowLines(row, widths, token.align);
  return [
    tableBorder(widths, TABLE_EDGES.top),
    ...render(header),
    tableBorder(widths, TABLE_EDGES.middle),
    ...rows.flatMap(render),
    tableBorder(widths, TABLE_EDGES.bottom),
  ];
}

function fitWidths(natural: number[], available: number): number[] {
  const widths = [...natural];
  const tableWidth = (): number => widths.reduce((sum, width) => sum + width + 3, 1);
  while (tableWidth() > available) {
    const widest = Math.max(...widths);
    if (widest <= MIN_CELL_WIDTH) break;
    widths[widths.indexOf(widest)] = widest - 1;
  }
  return widths;
}

function tableBorder(widths: number[], [left, middle, right]: readonly string[]): Line {
  const rule = widths.map((width) => "─".repeat(width + 2)).join(middle);
  return { gutter: [], body: [{ ...MUTED, text: `${left ?? ""}${rule}${right ?? ""}` }] };
}

function tableRowLines(cells: Span[][], widths: number[], align: Align[]): Line[] {
  const wrapped = widths.map((width, column) =>
    wrapLine({ gutter: [], body: cells[column] ?? [] }, width).map((line) => line.body),
  );
  const height = Math.max(...wrapped.map((rows) => rows.length));
  return Array.from({ length: height }, (_row, row): Line => {
    const body = widths.flatMap((width, column) => [
      { ...MUTED, text: column === 0 ? "│ " : " │ " },
      ...alignCell(wrapped[column]?.[row] ?? [], width, align[column] ?? null),
    ]);
    return { gutter: [], body: [...body, { ...MUTED, text: " │" }] };
  });
}

function alignCell(cell: Span[], width: number, align: Align): Span[] {
  const room = width - spansWidth(cell);
  const before = align === "right" ? room : align === "center" ? Math.floor(room / 2) : 0;
  return [{ text: " ".repeat(before) }, ...cell, { text: " ".repeat(room - before) }];
}

function cellSpans(tokens: Token[], style: SpanStyle): Span[] {
  return inlineSpans(tokens, style).map((span) => ({
    ...span,
    text: span.text.replaceAll("\n", " "),
  }));
}

function linkSpans(token: Tokens.Link, style: SpanStyle): Span[] {
  const label = inlineSpans(token.tokens, { ...style, ...LINK });
  const address: Span[] =
    token.text === token.href ? [] : [{ ...style, ...MUTED, text: ` (${token.href})` }];
  return [...label, ...address];
}

function textSpans(token: Token, style: SpanStyle): Span[] {
  const nested = "tokens" in token ? token.tokens : undefined;
  return nested === undefined ? [{ ...style, text: textOf(token) }] : inlineSpans(nested, style);
}

function inlineSpans(tokens: Token[], style: SpanStyle): Span[] {
  return tokens.flatMap((token) => {
    const render = INLINE_RENDERERS[token.type];
    return render === undefined ? [{ ...style, text: token.raw }] : render(token, style);
  });
}

function rowsToLines(rows: Span[][]): Line[] {
  return rows.map((body) => ({ gutter: [], body: body.length === 0 ? [{ text: " " }] : body }));
}

function prefixed(line: Line, gutter: Span[]): Line {
  return { ...line, gutter: [...gutter, ...line.gutter] };
}

function children(token: Token): Token[] {
  return "tokens" in token ? (token.tokens ?? []) : [];
}

function textOf(token: Token): string {
  return "text" in token && typeof token.text === "string" ? token.text : token.raw;
}

function spansWidth(spans: Span[]): number {
  return spans.reduce((width, span) => width + textWidth(span.text), 0);
}
