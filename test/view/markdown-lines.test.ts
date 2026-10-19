import { describe, expect, it } from "vitest";
import { REPLY_MARKER, type Line } from "../../src/view/line.js";
import { CODE_COLOURS } from "../../src/view/code-highlight.js";
import {
  inlineMarkdownRows,
  markdownLines,
  openTableRows,
  settledMarkdownRows,
} from "../../src/view/markdown-lines.js";
import { linesText } from "./line-text.js";

const shown = (text: string): string[] => linesText(markdownLines(REPLY_MARKER, text));
const bodyOf = (line: Line | undefined) => line?.body ?? [];
const trimmed = (lines: Line[]): string[] => linesText(lines).map((row) => row.trimEnd());

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

  it("fills a code panel to the full width so every row ends evenly", () => {
    const lines = markdownLines(REPLY_MARKER, "```ts\nif (a) {\n  b();\n}\n```");
    expect(trimmed(lines)).toEqual(["●  ts", "   if (a) {", "     b();", "   }"]);
    expect(linesText(lines).every((row) => row.length === 80)).toBe(true);
    const spans = lines.flatMap((line) => line.body);
    expect(spans.every((span) => span.background !== undefined)).toBe(true);
  });

  it("wraps a long code line inside the panel", () => {
    const lines = markdownLines(REPLY_MARKER, "```\naaaa bbbb cccc\n```", {}, 12);
    expect(trimmed(lines)).toEqual(["●  aaaa", "   bbbb", "   cccc"]);
    expect(linesText(lines).every((row) => row.length <= 12)).toBe(true);
  });

  it("leaves the language row out when the fence names none", () => {
    expect(trimmed(markdownLines(REPLY_MARKER, "```\nplain\n```"))).toEqual(["●  plain"]);
  });

  it("treats an unclosed fence as code so far", () => {
    expect(trimmed(markdownLines(REPLY_MARKER, "```\nhalf"))).toEqual(["●  half"]);
  });

  it("colours code by token", () => {
    const [, code] = markdownLines(REPLY_MARKER, '```ts\nconst a = "x";\n```');
    const body = bodyOf(code);
    const colourOf = (text: string) => body.find((span) => span.text === text)?.color;
    expect(colourOf("const")).toBe(CODE_COLOURS.keyword);
    expect(colourOf('"x"')).toBe(CODE_COLOURS.string);
  });

  it("draws a gutter beside a quote", () => {
    expect(shown("> careful\n> now")).toEqual(["● │ careful", "  │ now"]);
  });

  it("draws a table in a rounded box with aligned, padded cells", () => {
    expect(shown("| name | n |\n|---|--:|\n| a | 22 |\n| bb | 3 |")).toEqual([
      "● ╭──────┬────╮",
      "  │ name │  n │",
      "  ├──────┼────┤",
      "  │ a    │ 22 │",
      "  │ bb   │  3 │",
      "  ╰──────┴────╯",
    ]);
  });

  it("shrinks the widest column and wraps its cells to fit the width", () => {
    const table = "| k | value |\n|---|---|\n| a | one two three four |";
    const rows = linesText(markdownLines(REPLY_MARKER, table, {}, 22));
    expect(rows).toEqual([
      "● ╭───┬──────────────╮",
      "  │ k │ value        │",
      "  ├───┼──────────────┤",
      "  │ a │ one two      │",
      "  │   │ three four   │",
      "  ╰───┴──────────────╯",
    ]);
    expect(rows.every((row) => row.length <= 22)).toBe(true);
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

describe("openTableRows", () => {
  it("counts the rows of a table that is still the last block", () => {
    expect(openTableRows("intro\n\n| a | b |\n|---|---|\n| 1 | 2 |")).toBe(2);
  });

  it("is null when the last block is not a table", () => {
    expect(openTableRows("| a |\n|---|\n| 1 |\n\nafter")).toBeNull();
  });
});
