import { describe, expect, it } from "vitest";
import { assertBackendAllowed } from "../../src/config/backend-url.js";

describe("assertBackendAllowed", () => {
  it("accepts localhost", () => {
    expect(assertBackendAllowed("http://localhost:11434", [])).toBe("http://localhost:11434");
    expect(assertBackendAllowed("http://127.0.0.1:11434/", [])).toBe("http://127.0.0.1:11434");
  });

  it("accepts allow-listed hosts only", () => {
    expect(assertBackendAllowed("http://gpu-box.lan:11434", ["gpu-box.lan"])).toBe(
      "http://gpu-box.lan:11434",
    );
    expect(() => assertBackendAllowed("http://gpu-box.lan:11434", [])).toThrow(/not localhost/);
  });
});
