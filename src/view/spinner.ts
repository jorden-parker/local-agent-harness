import pc from "picocolors";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const INTERVAL_MS = 80;
const LABEL = "waiting for model";
const CLEAR_LINE = "\r\u001b[2K";

export function startSpinner(write: (text: string) => void): () => void {
  const startedAt = Date.now();
  let tick = 0;
  let stopped = false;
  const drawFrame = (): void => {
    const frame = pc.magenta(FRAMES[tick % FRAMES.length] ?? "");
    const waited = pc.gray(` · ${Math.floor((Date.now() - startedAt) / 1000)}s`);
    write(`\r${frame} ${pc.dim(LABEL)}${waited}`);
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
