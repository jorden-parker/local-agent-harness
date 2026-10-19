import type { ElementContent, RootContent } from "hast";
import { common, createLowlight } from "lowlight";
import { splitRows, type Span } from "./line.js";

type SpanStyle = Omit<Span, "text">;

export const CODE_COLOURS = {
  text: "#D7DAE0",
  keyword: "#B69CF2",
  string: "#7FD18B",
  number: "#F2A07B",
  comment: "#6B7280",
  title: "#7FB4F2",
  type: "#E6C07B",
  attribute: "#66C7D9",
  removed: "#F2777A",
  meta: "#9AA1AD",
} as const;

const TOKEN_STYLES: Readonly<Record<string, SpanStyle>> = {
  keyword: { color: CODE_COLOURS.keyword },
  built_in: { color: CODE_COLOURS.keyword },
  literal: { color: CODE_COLOURS.number },
  number: { color: CODE_COLOURS.number },
  string: { color: CODE_COLOURS.string },
  regexp: { color: CODE_COLOURS.removed },
  comment: { color: CODE_COLOURS.comment, italic: true },
  quote: { color: CODE_COLOURS.comment, italic: true },
  title: { color: CODE_COLOURS.title },
  section: { color: CODE_COLOURS.title, bold: true },
  type: { color: CODE_COLOURS.type },
  attr: { color: CODE_COLOURS.attribute },
  attribute: { color: CODE_COLOURS.attribute },
  property: { color: CODE_COLOURS.attribute },
  symbol: { color: CODE_COLOURS.attribute },
  bullet: { color: CODE_COLOURS.attribute },
  addition: { color: CODE_COLOURS.string },
  deletion: { color: CODE_COLOURS.removed },
  meta: { color: CODE_COLOURS.meta },
};

const lowlight = createLowlight(common);

export function highlightCode(
  code: string,
  language: string | undefined,
  style: SpanStyle,
): Span[][] {
  const base = { ...style, color: CODE_COLOURS.text };
  if (language === undefined || !lowlight.registered(language))
    return splitRows([{ ...base, text: code }]);
  const tree = lowlight.highlight(language, code);
  return splitRows(tree.children.flatMap((node) => nodeSpans(node, base)));
}

function nodeSpans(node: RootContent | ElementContent, style: SpanStyle): Span[] {
  if (node.type === "text") return [{ ...style, text: node.value }];
  if (node.type !== "element") return [];
  const tokenStyle = { ...style, ...styleForClasses(node.properties["className"]) };
  return node.children.flatMap((child) => nodeSpans(child, tokenStyle));
}

function styleForClasses(classes: unknown): SpanStyle {
  if (!Array.isArray(classes)) return {};
  const names = classes.map((name) => String(name).replace(/^hljs-/, ""));
  const match = names.find((name) => TOKEN_STYLES[name] !== undefined);
  return match === undefined ? {} : (TOKEN_STYLES[match] ?? {});
}
