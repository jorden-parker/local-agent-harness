const MAX_LINES = 2000;
const MAX_BYTES = 50_000;

export function truncateToolOutput(output: string): string {
  const lines = output.split("\n");
  if (lines.length > MAX_LINES) {
    const dropped = lines.length - MAX_LINES;
    return `${lines.slice(0, MAX_LINES).join("\n")}\n[truncated ${dropped} lines]`;
  }
  if (output.length > MAX_BYTES)
    return `${output.slice(0, MAX_BYTES)}\n[truncated ${output.length - MAX_BYTES} bytes]`;
  return output;
}
