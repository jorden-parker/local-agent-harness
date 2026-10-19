import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPreview } from "../../src/gate/preview.js";

describe("buildPreview", () => {
  it("shows the command for shell", async () => {
    expect(
      await buildPreview("/tmp", { id: "1", name: "shell", arguments: { command: "ls" } }),
    ).toBe("$ ls");
  });

  it("shows a unified diff for edit", async () => {
    const target = await mkdtemp(join(tmpdir(), "harness-"));
    await writeFile(join(target, "a.txt"), "one\ntwo\n");
    const preview = await buildPreview(target, {
      id: "1",
      name: "edit",
      arguments: { path: "a.txt", old: "two", new: "three" },
    });
    expect(preview).toContain("-two");
    expect(preview).toContain("+three");
  });
});
