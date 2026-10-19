import { mkdtemp, writeFile } from "node:fs/promises";
import { stripVTControlCharacters } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPreview } from "../../src/gate/preview.js";
import { renderPreview } from "../../src/view/preview-render.js";

const plain = (text: string): string => stripVTControlCharacters(text);

describe("renderPreview", () => {
  it("drops the file headers and keeps the hunk", () => {
    const preview = "Index: a.txt\n====\n--- a.txt\n+++ a.txt\n@@ -1,1 +1,1 @@\n-hello\n+bye\n";
    expect(plain(renderPreview(preview))).toBe("│  @@ -1,1 +1,1 @@\n│  -hello\n│  +bye");
  });

  it("shows a shell command", () => {
    expect(plain(renderPreview("$ ls -la"))).toBe("│  $ ls -la");
  });

  it("shows a message that has no hunk", () => {
    expect(plain(renderPreview("edit cannot be applied: see tool result"))).toBe(
      "│  edit cannot be applied: see tool result",
    );
  });

  it("keeps a removed line that looks like a file header inside a hunk", () => {
    expect(plain(renderPreview("@@ -1 +1 @@\n--- old\n+new\n"))).toBe(
      "│  @@ -1 +1 @@\n│  --- old\n│  +new",
    );
  });

  it("hides the Index and +++ headers of a real edit preview", async () => {
    const target = await mkdtemp(join(tmpdir(), "harness-preview-"));
    await writeFile(join(target, "a.txt"), "one\ntwo\n");
    const preview = await buildPreview(target, {
      id: "1",
      name: "edit",
      arguments: { path: "a.txt", old: "two", new: "three" },
    });
    const rendered = plain(renderPreview(preview));
    expect(rendered).not.toContain("Index:");
    expect(rendered).not.toContain("+++");
  });
});
