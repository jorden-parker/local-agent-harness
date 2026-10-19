import { Box, Text } from "ink";
import type { Line, Span } from "../line.js";
import { wrapLine } from "../wrap-line.js";

const BAND_BACKGROUND = "#1B2129";

function spanProps(span: Span) {
  return {
    ...(span.color === undefined ? {} : { color: span.color }),
    dimColor: span.dim === true,
    italic: span.italic === true,
    bold: span.bold === true,
    underline: span.underline === true,
    strikethrough: span.strikethrough === true,
    ...(span.background === undefined ? {} : { backgroundColor: span.background }),
  };
}

function Spans({ spans }: { spans: Span[] }) {
  return spans.map((span, index) => (
    <Text key={index} {...spanProps(span)}>
      {span.text}
    </Text>
  ));
}

function Row({ row }: { row: Line }) {
  const band = row.band === true ? { backgroundColor: BAND_BACKGROUND } : {};
  return (
    <Box flexDirection="row" width="100%" {...band}>
      <Box flexShrink={0}>
        <Text>
          <Spans spans={row.gutter} />
        </Text>
      </Box>
      <Box flexGrow={1}>
        <Text>
          <Spans spans={row.body} />
        </Text>
      </Box>
    </Box>
  );
}

export function LineView({ line, columns }: { line: Line; columns: number }) {
  return (
    <Box flexDirection="column">
      {wrapLine(line, columns).map((row, index) => (
        <Row key={index} row={row} />
      ))}
    </Box>
  );
}

export function Lines({ lines, columns }: { lines: Line[]; columns: number }) {
  return (
    <Box flexDirection="column">
      {lines.map((line, index) => (
        <LineView key={index} line={line} columns={columns} />
      ))}
    </Box>
  );
}
