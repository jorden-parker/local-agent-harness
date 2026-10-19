import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startSpinner } from "../../src/view/spinner.js";

const CLEAR_LINE = "\r\u001b[2K";

describe("startSpinner", () => {
  let writes: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    writes = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes a frame immediately and one more every 80 ms", () => {
    const stop = startSpinner((text) => {
      writes.push(text);
    });
    vi.advanceTimersByTime(160);
    expect(writes).toHaveLength(3);
    for (const write of writes) {
      const plain = stripVTControlCharacters(write);
      expect(plain.startsWith("\r")).toBe(true);
      expect(plain.endsWith("waiting for model")).toBe(true);
    }
    stop();
  });

  it("clears the line on stop and writes nothing afterwards", () => {
    const stop = startSpinner((text) => {
      writes.push(text);
    });
    stop();
    const writesAtStop = writes.length;
    vi.advanceTimersByTime(500);
    expect(writes.at(-1)).toBe(CLEAR_LINE);
    expect(writes).toHaveLength(writesAtStop);
  });

  it("writes the clear sequence only once when stopped twice", () => {
    const stop = startSpinner((text) => {
      writes.push(text);
    });
    stop();
    stop();
    expect(writes.filter((write) => write === CLEAR_LINE)).toHaveLength(1);
  });
});
