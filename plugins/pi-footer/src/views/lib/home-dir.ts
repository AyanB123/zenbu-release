import { useDb } from "@zenbujs/core/react";

/**
 * Inlined copy of the host's home-dir helpers. The host plugin
 * doesn't export these on a public subpath, and they're small —
 * easier to duplicate than to widen `@zenbu/app`'s exports
 * for one consumer.
 *
 * Reads `root.app.env.homeDir`, stamped by the host's `InitService`
 * at boot. Returns `null` while we're still catching up to the main
 * process on first load.
 */
export function useHomeDir(): string | null {
  return useDb((root) => root.app.env.homeDir);
}

/**
 * Collapse `<homeDir>/foo` to `~/foo` for display. Leaves the path
 * untouched when `homeDir` is null or the path doesn't live inside
 * it. Only matches at a path boundary so `/Users/robby-extra` isn't
 * mistakenly rewritten.
 */
export function displayPath(p: string, homeDir: string | null): string {
  if (!homeDir || !p) return p;
  if (p === homeDir) return "~";
  if (p.startsWith(homeDir + "/")) return "~" + p.slice(homeDir.length);
  return p;
}
