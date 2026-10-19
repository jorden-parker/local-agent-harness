const HARNESS_PACKAGE_NAME = "local-agent-harness";

export function chooseTargetDirectory(
  env: Record<string, string | undefined>,
  workingDirectory: string,
): string {
  const startedByOwnScript = env.npm_package_name === HARNESS_PACKAGE_NAME;
  return (startedByOwnScript ? env.INIT_CWD : undefined) ?? workingDirectory;
}
