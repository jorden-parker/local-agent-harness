import pc from "picocolors";

const GUTTER = `${pc.gray("│")} `;

export function renderPreview(preview: string): string {
  const lines = dropTrailingEmptyLine(dropFileHeaders(preview.split("\n")));
  return lines.map((line) => `${GUTTER}${colourLine(line)}`).join("\n");
}

function dropFileHeaders(lines: string[]): string[] {
  const firstHunk = lines.findIndex((line) => line.startsWith("@@"));
  return firstHunk === -1 ? lines : lines.slice(firstHunk);
}

function dropTrailingEmptyLine(lines: string[]): string[] {
  return lines.at(-1) === "" ? lines.slice(0, -1) : lines;
}

function colourLine(line: string): string {
  if (line.startsWith("+")) return pc.green(line);
  if (line.startsWith("-")) return pc.red(line);
  if (line.startsWith("$ ")) return pc.bold(line);
  return pc.dim(line);
}
