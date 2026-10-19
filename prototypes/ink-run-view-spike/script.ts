export type ScriptStep =
  | { kind: "thinking"; text: string }
  | { kind: "reply"; text: string }
  | { kind: "tool"; ok: boolean; label: string; output: string }
  | { kind: "gate"; tool: string; question: string; preview: string[] }
  | { kind: "wait"; ms: number };

const numbered = (count: number, prefix: string): string =>
  Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`).join("\n");

const longExplanation = [
  "Here is how the status command is wired today, so the change is easy to review.",
  "",
  ...Array.from(
    { length: 45 },
    (_, index) =>
      `${index + 1}. Step ${index + 1} of the walk-through: collect() gathers the repo state and printStatus() formats it line by line.`,
  ),
  "",
  "I'll branch on a new --json flag right before printStatus.",
].join("\n");

export const SCRIPT: ScriptStep[] = [
  {
    kind: "thinking",
    text: "The user wants a --json flag on status. I should find where the\ncommand is registered, then read the handler. It probably calls a\nprinter directly, so the cleanest change is to branch before printing.\nI will glob the commands folder first.",
  },
  { kind: "reply", text: "I'll check how the status command is wired first." },
  { kind: "tool", ok: true, label: "glob: src/commands/*.ts", output: numbered(6, "src/commands/file") },
  { kind: "tool", ok: true, label: "read: src/commands/status.ts", output: numbered(48, "  line") },
  { kind: "tool", ok: false, label: "read: .env", output: "secret-pattern file; rerun with --allow-secrets" },
  { kind: "wait", ms: 900 },
  { kind: "reply", text: longExplanation },
  {
    kind: "gate",
    tool: "edit",
    question: "Allow edit: src/commands/status.ts?",
    preview: [
      "@@ -12,7 +12,11 @@",
      " export function status(args: Args) {",
      "-  printStatus(collect());",
      "+  const report = collect();",
      "+  if (args.json) {",
      "+    console.log(JSON.stringify(report));",
      "+    return;",
      "+  }",
      "+  printStatus(report);",
      " }",
    ],
  },
  { kind: "tool", ok: true, label: "edit: src/commands/status.ts", output: "" },
  { kind: "wait", ms: 700 },
  {
    kind: "thinking",
    text: "The edit is in. Running the status tests is enough; the full suite\nis slow and unrelated.",
  },
  { kind: "reply", text: "Running the status tests." },
  { kind: "gate", tool: "shell", question: "Allow shell: pnpm test -- --run status?", preview: ["$ pnpm test -- --run status"] },
  { kind: "tool", ok: true, label: "shell: pnpm test -- --run status", output: numbered(14, "✓ status test") },
  { kind: "wait", ms: 600 },
  { kind: "reply", text: "Added --json to status; it prints the report as one JSON line.\nTests pass." },
];
