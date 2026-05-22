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
 * Defensive backfill for the pane-tab content discriminator.
 *
 * 0021 was supposed to convert every `{ id, chatId }` pane tab into
 * `{ id, content: { kind: "chat", chatId } }`, but some replicas ended
 * up at v22 with tabs still missing `content` (either because they
 * landed on v22 via a different code path, or because nested mutations
 * inside `apply()` weren't picked up). The renderer crashes the moment
 * it reads `tab.content.kind`, so this migration just walks every
 * windowState's pane tabs and normalises any tab missing `content`.
 *
 * Idempotent — tabs that already have `content` are left untouched.
 */
const migration: KyjuMigration = {
  version: 23,
  operations: [],
  migrate(prev, { apply }) {
    const result = apply(prev)
    const windowStates = result.windowStates as Record<string, any> | undefined
    if (!windowStates) return result
    for (const ws of Object.values(windowStates)) {
      const scopePanes = (ws as any).scopePanes as
        | Record<string, any>
        | undefined
      if (!scopePanes) continue
      for (const state of Object.values(scopePanes)) {
        const panes = (state as any).panes as any[] | undefined
        if (!panes) continue
        for (const pane of panes) {
          const tabs = pane.tabs as any[] | undefined
          if (!tabs) continue
          pane.tabs = tabs.map(t => {
            if (!t || typeof t !== "object") return t
            if (t.content && typeof t.content === "object" && "kind" in t.content) {
              return t
            }
            // Old shape: { id, chatId }. Lift chatId into content.
            const chatId =
              "chatId" in t && (typeof t.chatId === "string" || t.chatId === null)
                ? t.chatId
                : null
            return {
              id: t.id,
              content: { kind: "chat", chatId },
            }
          })
        }
      }
    }
    return result
  },
}

export default migration
