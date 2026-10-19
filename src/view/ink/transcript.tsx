import { Box } from "ink";
import { BLANK, type Line } from "../line.js";
import { FOOTER_ROWS } from "./footer.js";
import { wrapLine } from "../wrap-line.js";
import { Lines } from "./line-view.js";

const HEADER_ROWS = 2;
const MIN_PAGE_ROWS = 5;

export function transcriptPageRows(terminalRows: number): number {
  return Math.max(MIN_PAGE_ROWS, terminalRows - FOOTER_ROWS - HEADER_ROWS);
}

export function clampTranscriptTop(top: number, totalRows: number, pageRows: number): number {
  return Math.min(top, Math.max(0, totalRows - pageRows));
}

export function Transcript({
  lines,
  top,
  terminalRows,
  columns,
}: {
  lines: Line[];
  top: number;
  terminalRows: number;
  columns: number;
}) {
  const rows = lines.flatMap((line) => wrapLine(line, columns));
  const page = transcriptPageRows(terminalRows);
  const start = clampTranscriptTop(top, rows.length, page);
  const end = Math.min(rows.length, start + page);
  const header: Line = {
    gutter: [],
    body: [
      { text: "transcript", bold: true },
      { text: ` · lines ${start + 1}–${end} of ${rows.length} · all expanded`, color: "gray" },
    ],
  };
  return (
    <Box flexDirection="column" height={page + HEADER_ROWS}>
      <Lines lines={[header, BLANK]} columns={columns} />
      <Lines lines={rows.slice(start, end)} columns={columns} />
    </Box>
  );
}
