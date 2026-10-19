import { defineConfig } from "vitest/config";

const liveTestsEnabled = process.env["HARNESS_LIVE"] === "1";

export default defineConfig({
  test: {
    include: ["test/**/*.test.{ts,tsx}"],
    exclude: liveTestsEnabled ? [] : ["test/live/**"],
  },
});
