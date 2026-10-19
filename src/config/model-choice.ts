const FALLBACK_MODEL = "qwen3:8b";

export function chooseModel(
  flagModel: string | undefined,
  defaultModel: string | undefined,
): string {
  return flagModel ?? defaultModel ?? FALLBACK_MODEL;
}
