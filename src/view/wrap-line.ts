import type { Line, Span } from "./line.js";

const graphemes = new Intl.Segmenter();

interface Piece {
  span: Span;
  text: string;
  space: boolean;
}

export function wrapLine(line: Line, columns: number): Line[] {
  const gutterWidth = width(line.gutter.map((span) => span.text).join(""));
  const bodyWidth = Math.max(1, columns - gutterWidth);
  const rows = fillRows(pieces(line.body, bodyWidth), bodyWidth);
  const hanging: Span[] = [{ text: " ".repeat(gutterWidth) }];
  return rows.map((body, index) => ({
    ...line,
    gutter: index === 0 ? line.gutter : hanging,
    body,
  }));
}

function pieces(body: Span[], bodyWidth: number): Piece[] {
  return body.flatMap((span) =>
    (span.text.match(/\s+|\S+/g) ?? []).flatMap((text) => splitLong(span, text, bodyWidth)),
  );
}

function splitLong(span: Span, text: string, bodyWidth: number): Piece[] {
  const space = /^\s+$/.test(text);
  const characters = Array.from(graphemes.segment(text), (segment) => segment.segment);
  const chunks: Piece[] = [];
  for (let start = 0; start < characters.length; start += bodyWidth)
    chunks.push({ span, text: characters.slice(start, start + bodyWidth).join(""), space });
  return chunks;
}

function fillRows(all: Piece[], bodyWidth: number): Span[][] {
  const rows: Piece[][] = [[]];
  let used = 0;
  for (const piece of all) {
    const pieceWidth = width(piece.text);
    if (used + pieceWidth > bodyWidth && used > 0) {
      rows.push([]);
      used = 0;
    }
    if (piece.space && used === 0 && rows.length > 1) continue;
    rows.at(-1)?.push(piece);
    used += pieceWidth;
  }
  return rows.map(trimTrailingSpace).map(mergeSpans);
}

function trimTrailingSpace(row: Piece[]): Piece[] {
  return row.at(-1)?.space === true && row.length > 1 ? row.slice(0, -1) : row;
}

function mergeSpans(row: Piece[]): Span[] {
  const merged: Span[] = [];
  row.forEach((piece, index) => {
    const last = merged.at(-1);
    if (last !== undefined && row[index - 1]?.span === piece.span)
      merged[merged.length - 1] = { ...last, text: last.text + piece.text };
    else merged.push({ ...piece.span, text: piece.text });
  });
  return merged.length === 0 ? [{ text: " " }] : merged;
}

function width(text: string): number {
  return Array.from(graphemes.segment(text)).length;
}
