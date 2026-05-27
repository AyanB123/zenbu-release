type MigrationOp =
  | { op: "add"; key: string; kind: "data"; hasDefault: boolean; default?: any }
  | { op: "add"; key: string; kind: "collection"; debugName?: string }
  | { op: "add"; key: string; kind: "blob"; debugName?: string }
  | { op: "remove"; key: string; kind: "collection" | "blob" | "data" }
  | { op: "alter"; key: string; changes: Record<string, any> };

type KyjuMigration = {
  version: number;
  operations?: MigrationOp[];
  migrate?: (prev: any, ctx: { apply: (data: any) => any }) => any;
};

/**
 * Drop the auto-seeded chat from every sentinel workspace.
 *
 * Earlier versions of `SentinelWorkspaceService` seeded a pending
 * chat (and immediately materialized its session) the first time it
 * created the workspace. The renderer now treats "zero chats in the
 * sentinel workspace" as the signal to show the new
 * `plugin-onboarding` view in place of the chat area, but existing
 * replicas still carry that seeded chat — so the onboarding panel
 * never surfaces and the split button never flips to "New Plugin"
 * as its primary action.
 *
 * Cleanup rule:
 *   For every workspace with `sentinel === true`, walk all chats
 *   whose scope belongs to that workspace and drop the ones that
 *   were never actually used. A chat is considered unused when:
 *     - its session is still `pending` (the user never even saw
 *       it materialize), OR
 *     - its session is `ready` but `sessionMeta[sessionId]` does
 *       not exist (sessionMeta is only created on first
 *       `stampLastMessageSent`, i.e. after a real user message).
 *
 * We also remove the orphaned `sessions[sessionId]` entry for ready
 * chats we delete, since sentinel-seeded sessions are 1:1 with their
 * chat (the split-with-same-session path can't have touched them).
 * Pane / tab references in `windowStates.scopePanes` are not
 * scrubbed: the seeded chat was never opened in a pane (panes only
 * materialize on first user interaction), so there's nothing to
 * clean up there.
 *
 * Idempotent — running it a second time finds no matching chats
 * and does nothing.
 */
const migration: KyjuMigration = {
  version: 56,
  operations: [],
  migrate(prev, { apply }) {
    const result = apply(prev)

    const workspaces = result.workspaces as
      | Record<string, any>
      | undefined
    const scopes = result.scopes as Record<string, any> | undefined
    const chats = result.chats as Record<string, any> | undefined
    const sessions = result.sessions as Record<string, any> | undefined
    const sessionMeta = result.sessionMeta as
      | Record<string, any>
      | undefined
    if (!workspaces || !scopes || !chats) return result

    // Sentinel workspace ids in this replica. Usually exactly one,
    // but the migration tolerates multiple just in case.
    const sentinelWorkspaceIds = new Set(
      Object.values(workspaces)
        .filter(w => (w as any)?.sentinel === true)
        .map(w => (w as any).id as string),
    )
    if (sentinelWorkspaceIds.size === 0) return result

    // Scope ids that belong to a sentinel workspace.
    const sentinelScopeIds = new Set(
      Object.values(scopes)
        .filter(
          s =>
            typeof (s as any)?.workspaceId === "string" &&
            sentinelWorkspaceIds.has((s as any).workspaceId),
        )
        .map(s => (s as any).id as string),
    )
    if (sentinelScopeIds.size === 0) return result

    for (const [chatId, chat] of Object.entries(chats)) {
      const c = chat as any
      if (!c || typeof c !== "object") continue
      if (!sentinelScopeIds.has(c.scopeId)) continue

      const session = c.session
      if (!session || typeof session !== "object") continue

      if (session.kind === "pending") {
        delete chats[chatId]
        continue
      }
      if (session.kind === "ready" && typeof session.sessionId === "string") {
        const sid = session.sessionId
        const hasMeta = sessionMeta && sessionMeta[sid] != null
        if (hasMeta) continue
        // Unused ready chat: drop it and its session row.
        delete chats[chatId]
        if (sessions && sessions[sid] != null) {
          delete sessions[sid]
        }
      }
    }

    return result
  },
}

export default migration
