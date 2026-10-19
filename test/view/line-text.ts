import type { Line } from "../../src/view/line.js";

function lineText(line: Line): string {
  return [...line.gutter, ...line.body].map((span) => span.text).join("");
}

export function linesText(lines: Line[]): string[] {
  return lines.map(lineText);
}
