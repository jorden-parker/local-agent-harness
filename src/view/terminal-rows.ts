import { stripVTControlCharacters } from "node:util";

const graphemes = new Intl.Segmenter();

export function countRows(text: string, columns: number): number {
  return text
    .replace(/\n$/, "")
    .split("\n")
    .reduce((rows, line) => rows + rowsForLine(line, columns), 0);
}

function rowsForLine(line: string, columns: number): number {
  const width = Array.from(graphemes.segment(stripVTControlCharacters(line))).length;
  return Math.max(1, Math.ceil(width / columns));
}
