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
  version: 38,
  operations: [
    {
      "op": "alter",
      "key": "windowStates",
      "changes": {
        "typeHash": {
          "from": "5a75bc53dbd2f066",
          "to": "1e4c5f257ffe405a"
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    const result = apply(prev)
    // The schema reworked windowState so panes are workspace-scoped
    // instead of scope-scoped. `apply()` widens the type hash to the
    // new shape; this block transfers the data we can salvage:
    //
    //   - selectedWorkspaceId is derived from the old
    //     selectedScopeId via scope.workspaceId.
    //   - The active scope's old pane layout (scopePanes[selectedScopeId])
    //     becomes the workspace's pane layout (workspacePanes[wsId]).
    //     Other scopes' pane layouts in the same workspace are dropped
    //     — they'd conflict with the new "one pane layout per workspace"
    //     rule.
    //   - leftSidebarTab="scopes" coerces to "agent" (the tab is gone).
    //   - scopeLastChat / workspaceLastScope are obsolete and just
    //     get omitted.
    //
    // Best-effort. Existing users who had multi-pane setups in
    // multiple worktrees will land on a single workspace pane.
    const scopes = (prev?.scopes as Record<string, { workspaceId?: string }> | undefined) ?? {}
    const windowStates = (result.windowStates as Record<string, any> | undefined) ?? {}
    const prevWindowStates = (prev?.windowStates as Record<string, any> | undefined) ?? {}
    for (const [windowId, ws] of Object.entries(windowStates)) {
      const prevWs = prevWindowStates[windowId] ?? {}
      const prevSelectedScopeId =
        typeof prevWs.selectedScopeId === "string" ? prevWs.selectedScopeId : null
      const prevScopePanes =
        (prevWs.scopePanes as Record<string, any> | undefined) ?? {}

      // selectedWorkspaceId from selectedScopeId→ scope.workspaceId
      const workspaceId = prevSelectedScopeId
        ? scopes[prevSelectedScopeId]?.workspaceId ?? null
        : null
      ws.selectedWorkspaceId = workspaceId ?? null

      // workspacePanes: salvage the active scope's panes if available.
      if (!ws.workspacePanes) ws.workspacePanes = {}
      if (workspaceId && prevSelectedScopeId) {
        const oldPane = prevScopePanes[prevSelectedScopeId]
        if (oldPane && Array.isArray(oldPane.panes) && oldPane.panes.length > 0) {
          ws.workspacePanes[workspaceId] = {
            panes: oldPane.panes,
            activePaneId: oldPane.activePaneId,
          }
        }
      }

      // Ensure worktreeGroupCollapsed exists.
      if (!ws.worktreeGroupCollapsed) ws.worktreeGroupCollapsed = {}

      // leftSidebarTab: "scopes" → "agent".
      if (ws.leftSidebarTab !== "agent" && ws.leftSidebarTab !== "pi-sessions") {
        ws.leftSidebarTab = "agent"
      }
    }
    return result
  },
}

export default migration
