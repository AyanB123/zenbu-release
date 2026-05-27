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
  version: 52,
  operations: [
    {
      "op": "alter",
      "key": "windowStates",
      "changes": {
        "typeHash": {
          "from": "5a32ce9351d6e110",
          "to": "028b36f6db3d4e3b"
        }
      }
    }
  ],
  // Re-keys the pane layout from `windowState.workspacePanes[workspaceId]`
  // to `windowState.scopePanes[scopeId]`. Picks a representative scope
  // per old workspace entry (active tab's chat → any chat tab → primary
  // scope) and rehouses that workspace's panes under it, also stamping
  // `workspaceActiveScope[workspaceId] = scopeId` so reopening the
  // workspace lands back on the same scope.
  migrate(prev, { apply }) {
    const result = apply(prev)
    const prevWindowStates = (prev.windowStates ?? {}) as Record<string, any>
    const windowStates = result.windowStates as
      | Record<string, any>
      | undefined
    if (!windowStates) return result

    const chats = (result.chats as Record<string, any>) ?? {}
    const scopes = (result.scopes as Record<string, any>) ?? {}

    const chatScopeId = (chatId: string | null | undefined): string | null => {
      if (!chatId) return null
      const c = chats[chatId]
      return c?.scopeId ?? null
    }

    const primaryScopeOf = (workspaceId: string): string | null => {
      let best: { id: string; createdAt: number } | null = null
      for (const s of Object.values(scopes) as any[]) {
        if (s.workspaceId !== workspaceId) continue
        if (!best || s.createdAt < best.createdAt) {
          best = { id: s.id, createdAt: s.createdAt }
        }
      }
      return best?.id ?? null
    }

    const pickScope = (
      workspaceId: string,
      paneState: any,
    ): string | null => {
      const activePane =
        paneState.panes.find((p: any) => p.id === paneState.activePaneId) ??
        paneState.panes[0]
      const activeTab =
        activePane?.tabs.find((t: any) => t.id === activePane.activeTabId) ??
        activePane?.tabs[0]
      if (activeTab?.content?.kind === "chat") {
        const sid = chatScopeId(activeTab.content.chatId)
        if (sid) return sid
      }
      for (const pane of paneState.panes) {
        for (const tab of pane.tabs) {
          if (tab.content?.kind !== "chat") continue
          const sid = chatScopeId(tab.content.chatId)
          if (sid) return sid
        }
      }
      return primaryScopeOf(workspaceId)
    }

    for (const [windowId, ws] of Object.entries(windowStates) as [
      string,
      any,
    ][]) {
      const oldPanes: Record<string, any> =
        ws.workspacePanes ?? prevWindowStates[windowId]?.workspacePanes ?? {}
      const scopePanes: Record<string, any> = {}
      const workspaceActiveScope: Record<string, string> = {}

      for (const [workspaceId, paneState] of Object.entries(oldPanes)) {
        if (!paneState?.panes?.length) continue
        const scopeId = pickScope(workspaceId, paneState)
        if (!scopeId) continue
        // Last write wins if two workspaces happened to map to the
        // same scope. In practice workspaces own disjoint scopes,
        // so this is a non-issue.
        scopePanes[scopeId] = paneState
        workspaceActiveScope[workspaceId] = scopeId
      }

      ws.scopePanes = scopePanes
      ws.workspaceActiveScope = workspaceActiveScope
      delete ws.workspacePanes
    }

    return result
  },
}

export default migration
