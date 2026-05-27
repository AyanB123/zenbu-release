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
  version: 7,
  operations: [
    {
      "op": "remove",
      "key": "workspaceStates",
      "kind": "data"
    },
    {
      "op": "remove",
      "key": "scopeStates",
      "kind": "data"
    },
    {
      "op": "remove",
      "key": "chatStates",
      "kind": "data"
    },
    {
      "op": "alter",
      "key": "windowStates",
      "changes": {
        "typeHash": {
          "from": "8960bb1feadce5ab",
          "to": "b649f06679a080ca"
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    const result = apply(prev)
    const prevWindows = (prev.windowStates ?? {}) as Record<
      string,
      {
        selectedWorkspaceId?: string | null
        selectedScopeId?: string | null
        selectedChatId?: string | null
      }
    >
    const nextWindows: Record<
      string,
      {
        selectedScopeId: string | null
        workspaceLastScope: Record<string, string>
        scopeLastChat: Record<string, string>
      }
    > = {}
    for (const [windowId, prevWindow] of Object.entries(prevWindows)) {
      const workspaceLastScope: Record<string, string> = {}
      const scopeLastChat: Record<string, string> = {}
      if (prevWindow.selectedWorkspaceId && prevWindow.selectedScopeId) {
        workspaceLastScope[prevWindow.selectedWorkspaceId] =
          prevWindow.selectedScopeId
      }
      if (prevWindow.selectedScopeId && prevWindow.selectedChatId) {
        scopeLastChat[prevWindow.selectedScopeId] = prevWindow.selectedChatId
      }
      nextWindows[windowId] = {
        selectedScopeId: prevWindow.selectedScopeId ?? null,
        workspaceLastScope,
        scopeLastChat,
      }
    }
    result.windowStates = nextWindows
    return result
  },
}

export default migration
