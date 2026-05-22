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

const migration: KyjuMigration = {
  version: 20,
  operations: [
    {
      "op": "alter",
      "key": "windowStates",
      "changes": {
        "typeHash": {
          "from": "aba2eec7172ed33e",
          "to": "fb5e37c1b741aece"
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    const result = apply(prev)
    // Backfill scope-level pane state from `scopeLastChat`. For every
    // scope a window has touched we seed a single pane with one tab
    // pointing at the same chat the user last looked at, so the new
    // pane-aware ChatsHost lights up with the right chat instead of
    // an empty placeholder. Scopes that never had a `scopeLastChat`
    // entry get a single empty-tab pane lazily (created in the UI
    // helpers), so nothing to do for them here.
    const windowStates = result.windowStates as Record<string, any> | undefined
    if (windowStates) {
      for (const windowId of Object.keys(windowStates)) {
        const ws = windowStates[windowId]
        if (!ws) continue
        if (!ws.scopePanes || typeof ws.scopePanes !== "object") {
          ws.scopePanes = {}
        }
        const scopeLastChat = (ws.scopeLastChat ?? {}) as Record<string, string>
        for (const scopeId of Object.keys(scopeLastChat)) {
          if (ws.scopePanes[scopeId]) continue
          const chatId = scopeLastChat[scopeId] ?? null
          const paneId = `pane-${windowId}-${scopeId}-0`
          const tabId = `tab-${windowId}-${scopeId}-0`
          ws.scopePanes[scopeId] = {
            panes: [
              {
                id: paneId,
                tabs: [{ id: tabId, chatId }],
                activeTabId: tabId,
              },
            ],
            activePaneId: paneId,
          }
        }
      }
    }
    return result
  },
}

export default migration
