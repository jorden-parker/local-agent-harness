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

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const config = await loadUserConfig();
  const model = chooseModel(args.model, config.defaultModel);
  const backendUrl = assertBackendAllowed(args.backend, config.allowedBackendHosts);
  const target = await prepareTargetDirectory(process.cwd(), args.allowDirty);
  const log = await openRunLog(target, new Date());
  const systemPrompt = await buildSystemPrompt(target);
  process.stdout.write(pc.dim(`model ${model} via ${backendUrl}, log ${log.path}\n\n`));
  const result = await runTask(
    args.task,
    systemPrompt,
    { ...args.runOptions, target, model },
    {
      backend: new OllamaBackend(backendUrl),
      confirmer: new TerminalConfirmer(),
      log,
      out: (text) => process.stdout.write(text),
    },
  );
  process.stdout.write(
    pc.dim(`\n\nrun ended: ${result.endReason} after ${result.iterations} tool calls\n`),
  );
}

main().catch((error: unknown) => {
  process.stderr.write(pc.red(`${error instanceof Error ? error.message : String(error)}\n`));
  process.exit(1);
});
