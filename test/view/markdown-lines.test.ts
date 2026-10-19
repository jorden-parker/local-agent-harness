import { describe, expect, it } from "vitest";
import { REPLY_MARKER, type Line } from "../../src/view/line.js";
import {
  inlineMarkdownRows,
  markdownLines,
  settledMarkdownRows,
} from "../../src/view/markdown-lines.js";
import { linesText } from "./line-text.js";

const shown = (text: string): string[] => linesText(markdownLines(REPLY_MARKER, text));
const bodyOf = (line: Line | undefined) => line?.body ?? [];

describe("markdownLines blocks", () => {
  it("keeps the model's line breaks inside a paragraph", () => {
    expect(shown("one\ntwo")).toEqual(["● one", "  two"]);
  });

  it("puts one blank row between blocks", () => {
    expect(shown("# Title\nSome text.")).toEqual(["● Title", "   ", "  Some text."]);
  });

  it("hangs list items under their bullets, with nesting and task boxes", () => {
    expect(shown("- one\n- [x] two\n  1. nested\n  2. more")).toEqual([
      "● • one",
      "  • [x] two",
      "    1. nested",
      "    2. more",
    ]);
  });

  it("pads ordered markers to the widest number", () => {
    const list = Array.from({ length: 10 }, (_, index) => `${index + 1}. item`).join("\n");
    const rows = shown(list);
    expect(rows[0]).toBe("●  1. item");
    expect(rows[9]).toBe("  10. item");
  });

  it("keeps code block indentation on a band", () => {
    const lines = markdownLines(REPLY_MARKER, "```ts\nif (a) {\n  b();\n}\n```");
    expect(linesText(lines)).toEqual(["● if (a) {", "    b();", "  }"]);
    expect(lines.every((line) => line.band === true)).toBe(true);
  });

  it("treats an unclosed fence as code so far", () => {
    expect(shown("```\nhalf")).toEqual(["● half"]);
  });

  it("draws a gutter beside a quote", () => {
    expect(shown("> careful\n> now")).toEqual(["● │ careful", "  │ now"]);
  });

  it("aligns table columns", () => {
    expect(shown("| name | n |\n|---|--:|\n| a | 22 |\n| bb | 3 |")).toEqual([
      "● name │  n",
      "  ─────┼───",
      "  a    │ 22",
      "  bb   │  3",
    ]);
  });

  it("draws a rule for a thematic break", () => {
    expect(shown("---")[0]).toMatch(/^● ─+$/);
  });
});

describe("markdownLines inline", () => {
  it("styles bold, italic, strikethrough and code without their markers", () => {
    const [line] = markdownLines(REPLY_MARKER, "a **b** *c* ~~d~~ `e`");
    const body = bodyOf(line);
    expect(body.map((span) => span.text).join("")).toBe("a b c d e");
    expect(body.find((span) => span.text === "b")?.bold).toBe(true);
    expect(body.find((span) => span.text === "c")?.italic).toBe(true);
    expect(body.find((span) => span.text === "d")?.strikethrough).toBe(true);
    expect(body.find((span) => span.text === "e")?.background).toBeDefined();
  });

  it("underlines a link and shows its address when the text differs", () => {
    const [line] = markdownLines(REPLY_MARKER, "see [docs](https://x.dev)");
    const body = bodyOf(line);
    expect(body.map((span) => span.text).join("")).toBe("see docs (https://x.dev)");
    expect(body.find((span) => span.text === "docs")?.underline).toBe(true);
  });

  it("shows backslash escapes as the literal character", () => {
    expect(shown("\\*not em\\*")).toEqual(["● *not em*"]);
  });

  it("lays a base style under every span", () => {
    const [line] = markdownLines(REPLY_MARKER, "x **y**", { dim: true, italic: true });
    expect(bodyOf(line).every((span) => span.dim === true && span.italic === true)).toBe(true);
  });
});

describe("inlineMarkdownRows", () => {
  it("renders inline markdown in typed input and splits rows on newlines", () => {
    const rows = inlineMarkdownRows("add a `--json` flag\nto **status**");
    expect(rows.map((row) => row.map((span) => span.text).join(""))).toEqual([
      "add a --json flag",
      "to status",
    ]);
  });
});

describe("settledMarkdownRows", () => {
  it("counts the rows of every block before the one still being written", () => {
    expect(settledMarkdownRows("one\n\ntwo")).toBe(2);
    expect(settledMarkdownRows("only one")).toBe(0);
  });
});
