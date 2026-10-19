import { describe, expect, it } from "vitest";
import { readConfirmationKey } from "../../src/gate/confirmation-keys.js";

describe("readConfirmationKey", () => {
  it("answers straight away on y, n and a", () => {
    expect(readConfirmationKey(0, { name: "y" }).choice).toBe("y");
    expect(readConfirmationKey(0, { name: "n" }).choice).toBe("n");
    expect(readConfirmationKey(0, { name: "a" }).choice).toBe("a");
  });

  it("counts escape and ctrl+c as no", () => {
    expect(readConfirmationKey(0, { name: "escape" }).choice).toBe("n");
    expect(readConfirmationKey(0, { name: "c", ctrl: true }).choice).toBe("n");
  });

  it("moves the selection with the arrow keys and wraps around", () => {
    expect(readConfirmationKey(0, { name: "down" })).toEqual({ selected: 1, choice: null });
    expect(readConfirmationKey(0, { name: "up" })).toEqual({ selected: 2, choice: null });
    expect(readConfirmationKey(2, { name: "down" })).toEqual({ selected: 0, choice: null });
  });

  it("answers with the selected option on enter", () => {
    expect(readConfirmationKey(1, { name: "return" }).choice).toBe("n");
  });

  it("ignores other keys", () => {
    expect(readConfirmationKey(1, { name: "x" })).toEqual({ selected: 1, choice: null });
  });
});
