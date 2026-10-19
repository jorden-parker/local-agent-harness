import type { Key } from "ink";
import { describe, expect, it } from "vitest";
import { readGateKey } from "../../src/gate/confirmation-keys.js";

const NO_KEY: Key = {
  upArrow: false,
  downArrow: false,
  leftArrow: false,
  rightArrow: false,
  pageDown: false,
  pageUp: false,
  home: false,
  end: false,
  return: false,
  escape: false,
  ctrl: false,
  shift: false,
  tab: false,
  backspace: false,
  delete: false,
  meta: false,
  super: false,
  hyper: false,
  capsLock: false,
  numLock: false,
};
const press = (overrides: Partial<Key>): Key => ({ ...NO_KEY, ...overrides });

describe("readGateKey", () => {
  it("answers straight away on y, n and a", () => {
    expect(readGateKey("y", NO_KEY)).toEqual({ kind: "answer", choice: "y" });
    expect(readGateKey("n", NO_KEY)).toEqual({ kind: "answer", choice: "n" });
    expect(readGateKey("a", NO_KEY)).toEqual({ kind: "answer", choice: "a" });
  });

  it("counts escape and ctrl+c as no", () => {
    expect(readGateKey("", press({ escape: true }))).toEqual({ kind: "answer", choice: "n" });
    expect(readGateKey("c", press({ ctrl: true }))).toEqual({ kind: "answer", choice: "n" });
  });

  it("moves the selection with the arrow keys", () => {
    expect(readGateKey("", press({ downArrow: true }))).toEqual({ kind: "move", step: 1 });
    expect(readGateKey("", press({ upArrow: true }))).toEqual({ kind: "move", step: -1 });
  });

  it("submits the selected option on enter", () => {
    expect(readGateKey("", press({ return: true }))).toEqual({ kind: "submit" });
  });

  it("ignores other keys", () => {
    expect(readGateKey("x", NO_KEY)).toEqual({ kind: "none" });
  });
});
