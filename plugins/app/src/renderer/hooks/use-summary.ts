/**
 * Read the AI-generated summary for a session directly from the db.
 *
 * Lives inside the per-session metadata cache
 * (`root.app.sessionMeta[sessionId].summary.text`). The cache is
 * written by `SummariesService.record` on every prompt; the db
 * replica syncs it to the renderer automatically, so this is just a
 * `useDb` selector — no RPC, no events, no loading state.
 *
 * Returns `null` when no summary has been generated yet for this
 * session (e.g. fresh chat, agent still running). Callers fall back
 * to whatever label they already use (`session.title`,
 * `branchSummary`, "New Chat").
 */
import { useDb } from "@zenbujs/core/react"

export function useSummary(sessionId: string | null): string | null {
  return useDb(root => {
    if (!sessionId) return null
    return root.app.sessionMeta[sessionId]?.summary?.text ?? null
  })
}
