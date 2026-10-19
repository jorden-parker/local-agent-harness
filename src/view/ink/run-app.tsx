import { Static, useInput, type Key } from "ink";
import { useSyncExternalStore } from "react";
import type { RunStore } from "../run-store.js";
import { Footer } from "./footer.js";
import { LineView } from "./line-view.js";
import { LiveRegion } from "./live-region.js";
import { Transcript } from "./transcript.js";

export interface RunAppProps {
  store: RunStore;
  interactive: boolean;
  terminalRows: () => number;
  terminalColumns: () => number;
  onInput: (input: string, key: Key, terminalRows: number) => void;
}

export function RunApp(props: RunAppProps) {
  const { store, interactive, terminalRows, terminalColumns, onInput } = props;
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useInput(
    (input, key) => {
      onInput(input, key, terminalRows());
    },
    { isActive: interactive },
  );
  return (
    <>
      <Static items={state.committed}>
        {(entry) => <LineView key={entry.key} line={entry.line} columns={terminalColumns()} />}
      </Static>
      {state.transcript.open ? (
        <Transcript
          lines={store.transcriptLines()}
          top={state.transcript.top}
          terminalRows={terminalRows()}
          columns={terminalColumns()}
        />
      ) : (
        <LiveRegion state={state} animate={interactive} columns={terminalColumns()} />
      )}
      {interactive && !state.finished ? <Footer state={state} /> : null}
    </>
  );
}
