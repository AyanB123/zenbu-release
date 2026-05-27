import type { DbClient } from "@zenbujs/core/react"

/**
 * Module-level reference to the db client. Populated by the content
 * script's React root via `useDbClient()`; read by the CodeMirror
 * paste handler (which runs outside React, so it can't call hooks).
 *
 * Single global slot — there's only one renderer-side db client per
 * process. Multiple composers share this ref.
 */

let current: DbClient | null = null

export function setDbClient(client: DbClient | null): void {
  current = client
}

export function getDbClient(): DbClient | null {
  return current
}
