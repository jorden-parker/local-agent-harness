const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function assertBackendAllowed(url: string, allowedHosts: string[]): string {
  const parsed = new URL(url);
  if (LOCAL_HOSTS.has(parsed.hostname) || allowedHosts.includes(parsed.hostname))
    return parsed.origin;
  throw new Error(`backend host "${parsed.hostname}" is not localhost or in allowedBackendHosts`);
}
