import { Lexer, type Token, type Tokens } from "marked";
import { INDENT, SPACING, type Line, type Span } from "./line.js";
import { textWidth } from "./wrap-line.js";

type SpanStyle = Omit<Span, "text">;
type InlineRenderer = (token: Token, style: SpanStyle) => Span[];
type BlockRenderer = (token: Token, style: SpanStyle) => Line[];

const CODE_CHIP: SpanStyle = { color: "#E6C07B", background: "#1B2129" };
const LINK: SpanStyle = { color: "#7FB4F2", underline: true };
const MUTED: SpanStyle = { color: "gray" };
const QUOTE_GUTTER: Span = { text: "│ ", color: "gray" };
const TABLE_DIVIDER: Span = { text: " │ ", color: "gray" };
const BULLET = "• ";
const SKIPPED_BLOCKS: ReadonlySet<string> = new Set(["space", "def", "checkbox"]);
const BLANK_ROW: Line = { gutter: [], body: [{ text: " " }] };

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
  paragraph: (token, style) => inlineLines(token, style),
  text: (token, style) => inlineLines(token, style),
  heading: (token, style) => inlineLines(token, headingStyle(token as Tokens.Heading, style)),
  code: (token, style) => codeLines(textOf(token), style),
  blockquote: (token, style) =>
    joinBlocks(blockGroups(children(token), style), true).map((line) =>
      prefixed(line, [QUOTE_GUTTER]),
    ),
  list: (token, style) => listLines(token as Tokens.List, style),
  table: (token, style) => tableLines(token as Tokens.Table, style),
  hr: (_token, style) => [
    { gutter: [], body: [{ ...style, ...MUTED, text: "─".repeat(SPACING.ruleWidth) }] },
  ],
  html: (token, style) => rowsToLines(splitRows([{ ...style, dim: true, text: textOf(token) }])),
};

export function markdownLines(marker: Span, text: string, style: SpanStyle = {}): Line[] {
  const lines = joinBlocks(blockGroups(new Lexer().lex(text), style), true);
  return lines.map((line, index) => prefixed(line, [index === 0 ? marker : INDENT]));
}

export function inlineMarkdownRows(text: string, style: SpanStyle = {}): Span[][] {
  return splitRows(inlineSpans(Lexer.lexInline(text), style));
}

export function settledMarkdownRows(text: string): number {
  const groups = blockGroups(new Lexer().lex(text), {});
  return groups.slice(0, -1).reduce((rows, group) => rows + group.length + 1, 0);
}

function blockGroups(tokens: Token[], style: SpanStyle): Line[][] {
  return tokens
    .filter((token) => !SKIPPED_BLOCKS.has(token.type))
    .map((token) => renderBlock(token, style))
    .filter((lines) => lines.length > 0);
}

function renderBlock(token: Token, style: SpanStyle): Line[] {
  const render = BLOCK_RENDERERS[token.type];
  return render === undefined
    ? rowsToLines(splitRows([{ ...style, text: token.raw }]))
    : render(token, style);
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

function codeLines(code: string, style: SpanStyle): Line[] {
  return code
    .split("\n")
    .map((row) => ({ gutter: [], body: [{ ...style, text: row === "" ? " " : row }], band: true }));
}

function listLines(token: Tokens.List, style: SpanStyle): Line[] {
  const markers = token.items.map((_item, index) =>
    token.ordered ? `${listStart(token) + index}. ` : BULLET,
  );
  const width = Math.max(...markers.map(textWidth));
  return token.items.flatMap((item, index) => {
    const content = itemContent(item, style);
    const marker = (markers[index] ?? BULLET).padStart(width);
    return content.map((line, row) =>
      prefixed(line, [{ text: row === 0 ? marker : " ".repeat(width) }]),
    );
  });
}

function listStart(token: Tokens.List): number {
  return typeof token.start === "number" ? token.start : 1;
}

function itemContent(item: Tokens.ListItem, style: SpanStyle): Line[] {
  const lines = joinBlocks(blockGroups(item.tokens, style), item.loose);
  const [first, ...rest] = lines.length > 0 ? lines : [BLANK_ROW];
  if (!item.task || first === undefined) return [first ?? BLANK_ROW, ...rest];
  const box: Span = { ...style, ...MUTED, text: item.checked === true ? "[x] " : "[ ] " };
  return [{ ...first, body: [box, ...first.body] }, ...rest];
}

function tableLines(token: Tokens.Table, style: SpanStyle): Line[] {
  const header = token.header.map((cell) => cellSpans(cell.tokens, { ...style, bold: true }));
  const rows = token.rows.map((row) => row.map((cell) => cellSpans(cell.tokens, style)));
  const widths = header.map((_cell, column) =>
    Math.max(...[header, ...rows].map((row) => spansWidth(row[column] ?? []))),
  );
  const divider: Line = {
    gutter: [],
    body: [{ ...MUTED, text: widths.map((width) => "─".repeat(width)).join("─┼─") }],
  };
  const render = (row: Span[][]): Line => tableRow(row, widths, token.align);
  return [render(header), divider, ...rows.map(render)];
}

function tableRow(cells: Span[][], widths: number[], align: Tokens.Table["align"]): Line {
  const body = widths.flatMap((width, column) => {
    const cell = alignCell(cells[column] ?? [], width, align[column] ?? null);
    return column === 0 ? cell : [TABLE_DIVIDER, ...cell];
  });
  return { gutter: [], body };
}

function alignCell(cell: Span[], width: number, align: "left" | "right" | "center" | null): Span[] {
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

function splitRows(spans: Span[]): Span[][] {
  const rows: Span[][] = [[]];
  for (const span of spans) {
    span.text.split("\n").forEach((part, index) => {
      if (index > 0) rows.push([]);
      if (part !== "") rows.at(-1)?.push({ ...span, text: part });
    });
  }
  return rows;
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
