import pc from "picocolors";
import { OllamaBackend } from "./backend/ollama-backend.js";
import { parseCliArgs } from "./cli-args.js";
import { assertBackendAllowed } from "./config/backend-url.js";
import { chooseModel } from "./config/model-choice.js";
import { loadUserConfig } from "./config/user-config.js";
import { TerminalConfirmer } from "./gate/terminal-confirmer.js";
import { prepareTargetDirectory } from "./git/target-directory.js";
import { openRunLog } from "./log/run-log.js";
import { buildSystemPrompt } from "./prompt/system-prompt.js";
import { runTask } from "./run/run-loop.js";
import { formatRunHeader, formatRunSummary, ruleWidth } from "./view/run-frame.js";
import { TerminalRunView } from "./view/terminal-run-view.js";

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const config = await loadUserConfig();
  const model = chooseModel(args.model, config.defaultModel);
  const backendUrl = assertBackendAllowed(args.backend, config.allowedBackendHosts);
  const target = await prepareTargetDirectory(process.cwd(), args.allowDirty);
  const log = await openRunLog(target, new Date());
  const systemPrompt = await buildSystemPrompt(target);
  const width = ruleWidth(process.stdout.columns);
  const write = (text: string): void => {
    process.stdout.write(text);
  };
  write(
    formatRunHeader(
      { model, backendUrl, logPath: log.path, task: args.task, think: args.runOptions.think },
      width,
    ),
  );
  const startedAt = Date.now();
  const result = await runTask(
    args.task,
    systemPrompt,
    { ...args.runOptions, target, model },
    {
      backend: new OllamaBackend(backendUrl),
      confirmer: new TerminalConfirmer(),
      log,
      view: new TerminalRunView(write, process.stdout.isTTY),
    },
  );
  write(formatRunSummary(result, Date.now() - startedAt, width));
}

main().catch((error: unknown) => {
  process.stderr.write(pc.red(`${error instanceof Error ? error.message : String(error)}\n`));
  process.exit(1);
});
