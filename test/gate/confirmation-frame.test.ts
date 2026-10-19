import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import {
  formatAnsweredConfirmation,
  formatPendingConfirmation,
  type ConfirmationPrompt,
} from "../../src/gate/confirmation-frame.js";

const plain = (text: string): string => stripVTControlCharacters(text);

const shellPrompt: ConfirmationPrompt = {
  question: "Allow shell: pnpm test?",
  preview: "$ pnpm test",
  toolName: "shell",
};

describe("formatPendingConfirmation", () => {
  it("shows the question, preview, options and key hints", () => {
    expect(plain(formatPendingConfirmation(shellPrompt, 0))).toBe(
      [
        "◆ Allow shell: pnpm test?",
        "│ $ pnpm test",
        "│",
        "│ ● yes",
        "│ ○ no",
        "│ ○ allow every shell for this run",
        "└",
        "y yes   n no   a allow every shell   esc counts as no",
        "",
      ].join("\n"),
    );
  });

  it("moves the filled dot to the selected option", () => {
    const lines = plain(formatPendingConfirmation(shellPrompt, 2)).split("\n");
    expect(lines[3]).toBe("│ ○ yes");
    expect(lines[5]).toBe("│ ● allow every shell for this run");
  });

  it("leaves out the preview when there is none", () => {
    const lines = plain(formatPendingConfirmation({ ...shellPrompt, preview: "" }, 0)).split("\n");
    expect(lines.slice(0, 3)).toEqual(["◆ Allow shell: pnpm test?", "│", "│ ● yes"]);
  });
});

describe("formatAnsweredConfirmation", () => {
  it("puts the answer on the question line and keeps the preview", () => {
    expect(plain(formatAnsweredConfirmation(shellPrompt, "y"))).toBe(
      "◇ Allow shell: pnpm test? · yes\n│ $ pnpm test\n",
    );
  });

  it("names a run-wide allow in the answer", () => {
    expect(plain(formatAnsweredConfirmation(shellPrompt, "a"))).toMatch(
      /· allow every shell for this run\n/,
    );
  });
});
