import { stringArgument, type ToolCall } from "./tool-call.js";

export interface ConfinementFlags {
  allowSecrets: boolean;
}

const PROTECTED_PREFIXES = [".harness/", ".git/"];
const PROTECTED_FILES = new Set([".gitignore", ".harness", ".git"]);
const SECRET_PATTERNS = [
  /^\.env(\..*)?$/,
  /\.pem$/,
  /^id_(rsa|ed25519)$/,
  /credentials/i,
  /\.key$/,
];
const SHELL_DENYLIST = [
  /\brm\s+-[a-z]*r[a-z]*f?[a-z]*\s+\/(\s|$)/,
  /\bgit\s+push\b.*(--force|-f\b)/,
  /\b(curl|wget)\b.*\|\s*(ba|z)?sh\b/,
  /\bsudo\b/,
  /\bmkfs\b/,
  /\bdd\s+if=/,
];

export function confinementError(call: ToolCall, flags: ConfinementFlags): string | null {
  try {
    return call.name === "shell" ? shellError(call) : pathError(call, flags);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function shellError(call: ToolCall): string | null {
  const command = stringArgument(call, "command");
  return SHELL_DENYLIST.some((pattern) => pattern.test(command))
    ? "denylisted command, never run"
    : null;
}

function pathError(call: ToolCall, flags: ConfinementFlags): string | null {
  if (call.name === "glob" || call.name === "grep") return null;
  const path = stringArgument(call, "path");
  if (path.startsWith("/")) return "absolute paths are not allowed";
  const relative = normaliseRelativePath(path);
  if (relative === null) return "path escapes the target directory";
  if (isProtected(relative)) return "protected path";
  if (!flags.allowSecrets && isSecret(relative))
    return "secret-pattern file; rerun with --allow-secrets";
  return null;
}

export function normaliseRelativePath(path: string): string | null {
  const parts: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment !== "..") {
      parts.push(segment);
      continue;
    }
    if (parts.length === 0) return null;
    parts.pop();
  }
  return parts.join("/");
}

function isProtected(relative: string): boolean {
  return (
    PROTECTED_FILES.has(relative) ||
    PROTECTED_PREFIXES.some((prefix) => relative.startsWith(prefix))
  );
}

function isSecret(relative: string): boolean {
  const basename = relative.split("/").pop() ?? relative;
  return SECRET_PATTERNS.some((pattern) => pattern.test(basename));
}
