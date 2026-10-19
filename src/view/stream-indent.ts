const INDENT = "  ";

export interface IndentedChunk {
  text: string;
  atLineStart: boolean;
}

export function indentStream(text: string, atLineStart: boolean): IndentedChunk {
  if (text === "") return { text, atLineStart };
  const indented = text
    .split("\n")
    .map((segment, index) => indentSegment(segment, index === 0 ? atLineStart : true));
  return { text: indented.join("\n"), atLineStart: text.endsWith("\n") };
}

function indentSegment(segment: string, startsLine: boolean): string {
  return startsLine && segment !== "" ? INDENT + segment : segment;
}
