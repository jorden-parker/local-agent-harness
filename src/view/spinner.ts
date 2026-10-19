import pc from "picocolors";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const INTERVAL_MS = 80;
const LABEL = "waiting for model";
const CLEAR_LINE = "\r\u001b[2K";

export function startSpinner(write: (text: string) => void): () => void {
  let tick = 0;
  let stopped = false;
  const drawFrame = (): void => {
    write(pc.dim(`\r${FRAMES[tick % FRAMES.length] ?? ""} ${LABEL}`));
  };
  drawFrame();
  const timer = setInterval(() => {
    tick += 1;
    drawFrame();
  }, INTERVAL_MS);
  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    write(CLEAR_LINE);
  };
}
