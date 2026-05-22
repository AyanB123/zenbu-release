import { useDb } from "@zenbujs/core/react"

/**
 * The user's home directory, stamped into replicated state by
 * `InitService` on every boot. Returns `null` while we're still
 * catching up to the main process on first load.
 */
export function useHomeDir(): string | null {
  return useDb(root => root.app.env.homeDir)
}

/**
 * Collapse `<homeDir>/foo` to `~/foo` for display. Leaves the path
 * untouched when `homeDir` is null or the path doesn't live inside it.
 * Only matches at a path boundary so `/Users/robby-extra` isn't
 * mistakenly rewritten.
 */
export function displayPath(p: string, homeDir: string | null): string {
  if (!homeDir || !p) return p
  if (p === homeDir) return "~"
  if (p.startsWith(homeDir + "/")) return "~" + p.slice(homeDir.length)
  return p
}

/**
 * Like `displayPath` but rewrites every occurrence of the home dir
 * inside a free-form string (e.g. a bash command). Only substitutes
 * at path boundaries so `${HOME}-backup` isn't mangled.
 */
export function collapseHomeDir(s: string, homeDir: string | null): string {
  if (!homeDir || !s) return s
  // Replace `<homeDir>` followed by `/`, end-of-string, or a
  // non-path-ish character.
  const escaped = homeDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const re = new RegExp(escaped + "(?=/|$|[\\s'\"`,;:)\\]}])", "g")
  return s.replace(re, "~")
}
