import pc from "picocolors";
import { OllamaBackend } from "./backend/ollamaBackend.js";
import { parseCliArgs } from "./cliArgs.js";
import { assertBackendAllowed } from "./config/backendUrl.js";
import { loadUserConfig } from "./config/userConfig.js";
import { TerminalConfirmer } from "./gate/terminalConfirmer.js";
import { prepareTargetDirectory } from "./git/targetDirectory.js";
import { openRunLog } from "./log/runLog.js";
import { buildSystemPrompt } from "./prompt/systemPrompt.js";
import { runTask } from "./run/runLoop.js";

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const config = await loadUserConfig();
  const backendUrl = assertBackendAllowed(args.backend, config.allowedBackendHosts);
  const target = await prepareTargetDirectory(process.cwd(), args.allowDirty);
  const log = await openRunLog(target, new Date());
  const systemPrompt = await buildSystemPrompt(target);
  process.stdout.write(pc.dim(`model ${args.model} via ${backendUrl}, log ${log.path}\n\n`));
  const result = await runTask(
    args.task,
    systemPrompt,
    { ...args.runOptions, target, model: args.model },
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
