#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const tsx = join(root, "node_modules", ".bin", "tsx");
const result = spawnSync(tsx, [join(root, "src", "cli.ts"), ...process.argv.slice(2)], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
