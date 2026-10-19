import { Box, Text } from "ink";
import type { Toggles } from "../block-lines.js";
import { SPACING } from "../line.js";
import type { RunViewState } from "../run-store.js";

type Hint = [key: string, label: string];

const TRANSCRIPT_HINTS: Hint[] = [
  ["↑ ↓ pgup pgdn", "scroll"],
  ["ctrl+o esc", "close"],
];

export const FOOTER_ROWS = SPACING.footerGap + 1;

function toggleHints(toggles: Toggles): Hint[] {
  return [
    ["t", `thinking ${toggles.thinking ? "on" : "off"}`],
    ["o", `tool output ${toggles.toolOutput ? "on" : "off"}`],
    ["ctrl+o", "transcript"],
  ];
}

function gateHints(state: RunViewState): Hint[] {
  if (state.live.kind !== "gate") return [];
  return [
    ["y", "yes"],
    ["n", "no"],
    ["a", `allow every ${state.live.prompt.toolName}`],
    ["esc", "counts as no"],
  ];
}

function footerHints(state: RunViewState): Hint[] {
  if (state.transcript.open) return TRANSCRIPT_HINTS;
  return [...gateHints(state), ...toggleHints(state.toggles)];
}

export function Footer({ state }: { state: RunViewState }) {
  return (
    <Box marginTop={SPACING.footerGap} columnGap={3} flexWrap="wrap">
      {footerHints(state).map(([key, label]) => (
        <Text key={key}>
          <Text color="cyan" bold>
            {key}
          </Text>
          <Text color="gray"> {label}</Text>
        </Text>
      ))}
    </Box>
  );
}
