import { describe, expect, it } from "vitest";
import { chooseTargetDirectory } from "../../src/config/target-choice.js";

describe("chooseTargetDirectory", () => {
  it("uses the working directory when started directly", () => {
    expect(chooseTargetDirectory({}, "/repo")).toBe("/repo");
  });

  it("uses the directory pnpm was started from for this package's script", () => {
    const env = { npm_package_name: "local-agent-harness", INIT_CWD: "/other/repo" };
    expect(chooseTargetDirectory(env, "/harness")).toBe("/other/repo");
  });

  it("ignores INIT_CWD set by another package's script", () => {
    const env = { npm_package_name: "some-app", INIT_CWD: "/some-app/sub" };
    expect(chooseTargetDirectory(env, "/some-app")).toBe("/some-app");
  });

  it("uses the working directory when pnpm sets no INIT_CWD", () => {
    expect(chooseTargetDirectory({ npm_package_name: "local-agent-harness" }, "/harness")).toBe(
      "/harness",
    );
  });
});
