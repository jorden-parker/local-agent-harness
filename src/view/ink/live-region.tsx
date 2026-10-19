import { useEffect, useState } from "react";
import { liveLines } from "../live-lines.js";
import type { RunViewState } from "../run-store.js";
import { Lines } from "./line-view.js";

const SPINNER_INTERVAL_MS = 80;

function useSpinnerFrame(spinning: boolean): number {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!spinning) return;
    const timer = setInterval(() => {
      setFrame((current) => current + 1);
    }, SPINNER_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [spinning]);
  return frame;
}

export interface LiveRegionProps {
  state: RunViewState;
  animate: boolean;
  columns: number;
}

export function LiveRegion({ state, animate, columns }: LiveRegionProps) {
  const frame = useSpinnerFrame(animate && state.live.kind === "waiting");
  if (!animate && state.live.kind === "waiting") return null;
  const context = { toggles: state.toggles, lastKind: state.lastKind, frame, now: Date.now() };
  return <Lines lines={liveLines(state.live, context)} columns={columns} />;
}
