import { isatty } from "node:tty";
import pc from "picocolors";
import { OllamaBackend } from "./backend/ollama-backend.js";
import { parseCliArgs } from "./cli-args.js";
import { assertBackendAllowed } from "./config/backend-url.js";
import { chooseModel } from "./config/model-choice.js";
import { loadUserConfig } from "./config/user-config.js";
import { prepareTargetDirectory } from "./git/target-directory.js";
import { openRunLog } from "./log/run-log.js";
import { buildSystemPrompt } from "./prompt/system-prompt.js";
import { runTask } from "./run/run-loop.js";
import { InkRunView } from "./view/ink-run-view.js";

const INTERRUPTED_EXIT_CODE = 130;
const STDIN_FD = 0;
const STDOUT_FD = 1;

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const config = await loadUserConfig();
  const model = chooseModel(args.model, config.defaultModel);
  const backendUrl = assertBackendAllowed(args.backend, config.allowedBackendHosts);
  const target = await prepareTargetDirectory(process.cwd(), args.allowDirty);
  const log = await openRunLog(target, new Date());
  const systemPrompt = await buildSystemPrompt(target);
  const view = new InkRunView({
    stdout: process.stdout,
    stdin: process.stdin,
    interactive: isatty(STDIN_FD) && isatty(STDOUT_FD),
    onInterrupt: () => process.exit(INTERRUPTED_EXIT_CODE),
  });
  view.start({
    model,
    backendUrl,
    logPath: log.path,
    task: args.task,
    think: args.runOptions.think,
  });
  const startedAt = Date.now();
  try {
    const result = await runTask(
      args.task,
      systemPrompt,
      { ...args.runOptions, target, model },
      { backend: new OllamaBackend(backendUrl), confirmer: view, log, view },
    );
    await view.finish(result, Date.now() - startedAt);
  } catch (error) {
    await view.close();
    throw error;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(pc.red(`${error instanceof Error ? error.message : String(error)}\n`));
  process.exit(1);
});
