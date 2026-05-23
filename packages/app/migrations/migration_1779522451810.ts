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
  version: 49,
  operations: [
    {
      "op": "alter",
      "key": "windowStates",
      "changes": {
        "typeHash": {
          "from": "505b402aded2ba51",
          "to": "5a32ce9351d6e110"
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    const result = apply(prev)
    // Reshape `windowState` from the old window-wide layout flags
    // into the new (workspaceUiStates, scopeUiStates) records:
    //
    //  - `sidebarWidth`, `leftSidebarOpen`, `leftSidebarTab` follow
    //    the *workspace* (the left sidebar is workspace-wide).
    //  - `rightSidebarWidth`, `terminalHeight`, `bottomPanelOpen`,
    //    `bottomPanelView`, `rightSidebarOpenType`,
    //    `rightSidebarLastType` follow the *scope* (the right
    //    sidebar and bottom panel render scope-parameterized
    //    content via iframe args; their state should track the
    //    active worktree the way their content already does).
    //
    // For each existing windowState we:
    //   1. Seed `workspaceUiStates[activeWorkspaceId]` with the old
    //      window-level workspace-shaped flags (only on the
    //      currently-active workspace — other workspaces never had
    //      explicit state in the old model, so they start fresh).
    //   2. Seed every scope in that workspace with the old
    //      window-level scope-shaped flags, so re-visiting any
    //      worktree shows the same panel layout the user just had.
    //      Per-scope divergence happens naturally on first edit.
    //   3. Strip the legacy fields off windowState; they no longer
    //      live there.
    const scopes = result.scopes as Record<string, any> | undefined
    const windowStates = result.windowStates as
      | Record<string, any>
      | undefined

    // workspaceId -> [scopeId] index so we don't re-walk `scopes`
    // for each window.
    const scopesByWorkspace = new Map<string, string[]>()
    if (scopes) {
      for (const scope of Object.values(scopes) as Array<any>) {
        const wsId = scope?.workspaceId as string | undefined
        const sid = scope?.id as string | undefined
        if (!wsId || !sid) continue
        const list = scopesByWorkspace.get(wsId) ?? []
        list.push(sid)
        scopesByWorkspace.set(wsId, list)
      }
    }

    if (windowStates) {
      for (const ws of Object.values(windowStates) as Array<any>) {
        if (!ws.workspaceUiStates) ws.workspaceUiStates = {}
        if (!ws.scopeUiStates) ws.scopeUiStates = {}

        const activeWorkspaceId =
          ws.activeView?.kind === "workspace"
            ? (ws.activeView.workspaceId as string | undefined)
            : undefined

        const leftSidebarOpen =
          typeof ws.leftSidebarOpen === "boolean" ? ws.leftSidebarOpen : true
        const leftSidebarTab =
          ws.leftSidebarTab === "agent" || ws.leftSidebarTab === "pi-sessions"
            ? ws.leftSidebarTab
            : "agent"
        const bottomPanelOpen =
          typeof ws.bottomPanelOpen === "boolean"
            ? ws.bottomPanelOpen
            : false
        const bottomPanelView =
          typeof ws.bottomPanelView === "string" ? ws.bottomPanelView : null
        const rightSidebarOpenType =
          typeof ws.rightSidebarOpenType === "string"
            ? ws.rightSidebarOpenType
            : null
        const rightSidebarLastType =
          typeof ws.rightSidebarLastType === "string"
            ? ws.rightSidebarLastType
            : null

        // (1) Seed the active workspace's UI-state entry with the
        // workspace-shaped flags.
        if (activeWorkspaceId) {
          const existing = ws.workspaceUiStates[activeWorkspaceId] ?? {
            sidebarWidth: null,
            leftSidebarOpen: true,
            leftSidebarTab: "agent",
          }
          ws.workspaceUiStates[activeWorkspaceId] = {
            sidebarWidth: existing.sidebarWidth ?? null,
            leftSidebarOpen: existing.leftSidebarOpen ?? leftSidebarOpen,
            leftSidebarTab: existing.leftSidebarTab ?? leftSidebarTab,
          }

          // (2) Seed every scope in the active workspace with the
          // scope-shaped flags, so the panel layout the user just
          // had carries to every worktree they might land on.
          const scopeIds = scopesByWorkspace.get(activeWorkspaceId) ?? []
          for (const scopeId of scopeIds) {
            const ex = ws.scopeUiStates[scopeId] ?? {
              rightSidebarWidth: null,
              terminalHeight: null,
              bottomPanelOpen: false,
              bottomPanelView: null,
              rightSidebarOpenType: null,
              rightSidebarLastType: null,
            }
            ws.scopeUiStates[scopeId] = {
              rightSidebarWidth: ex.rightSidebarWidth ?? null,
              terminalHeight: ex.terminalHeight ?? null,
              bottomPanelOpen: ex.bottomPanelOpen ?? bottomPanelOpen,
              bottomPanelView: ex.bottomPanelView ?? bottomPanelView,
              rightSidebarOpenType:
                ex.rightSidebarOpenType ?? rightSidebarOpenType,
              rightSidebarLastType:
                ex.rightSidebarLastType ?? rightSidebarLastType,
            }
          }
        }

        // (3) Strip the legacy window-level fields regardless of
        // whether we found a workspace to migrate them onto — the
        // new schema doesn't define them, so leaving them around
        // would just be dead bytes on disk.
        delete ws.leftSidebarOpen
        delete ws.bottomPanelOpen
        delete ws.bottomPanelView
        delete ws.rightSidebarOpenType
        delete ws.rightSidebarLastType
        delete ws.leftSidebarTab
      }
    }
    return result
  },
}

export default migration
