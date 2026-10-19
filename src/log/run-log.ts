import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface RunLog {
  record(entry: Record<string, unknown>): Promise<void>;
  path: string;
}

export async function openRunLog(target: string, startedAt: Date): Promise<RunLog> {
  const harnessDirectory = join(target, ".harness");
  const runsDirectory = join(harnessDirectory, "runs");
  await mkdir(runsDirectory, { recursive: true });
  await writeFile(join(harnessDirectory, ".gitignore"), "*\n");
  const path = join(runsDirectory, `${startedAt.toISOString().replace(/[:.]/g, "-")}.jsonl`);
  return {
    path,
    record: (entry) =>
      appendFile(path, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`),
  };
}
