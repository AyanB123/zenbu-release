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
  version: 5,
  operations: [
    {
      "op": "add",
      "key": "scopes",
      "kind": "data",
      "hasDefault": true,
      "default": {}
    },
    {
      "op": "add",
      "key": "scopeStates",
      "kind": "data",
      "hasDefault": true,
      "default": {}
    },
    {
      "op": "remove",
      "key": "workspaceItems",
      "kind": "data"
    },
    {
      "op": "remove",
      "key": "workspaceItemStates",
      "kind": "data"
    },
    {
      "op": "alter",
      "key": "chats",
      "changes": {
        "typeHash": {
          "from": "bbc78e9e72e6e317",
          "to": "e274c6a653a1d416"
        }
      }
    },
    {
      "op": "alter",
      "key": "sessions",
      "changes": {
        "typeHash": {
          "from": "49b26c92d9d0c6b7",
          "to": "d10167c32ef4beab"
        }
      }
    },
    {
      "op": "alter",
      "key": "windowStates",
      "changes": {
        "typeHash": {
          "from": "ab5cc63f28db09c1",
          "to": "8960bb1feadce5ab"
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    const oldItems = (prev?.workspaceItems ?? {}) as Record<string, any>
    const oldItemStates = (prev?.workspaceItemStates ?? {}) as Record<string, any>
    const oldChats = (prev?.chats ?? {}) as Record<string, any>
    const oldSessions = (prev?.sessions ?? {}) as Record<string, any>
    const oldWindowStates = (prev?.windowStates ?? {}) as Record<string, any>

    const result = apply(prev)

    result.scopes = {}
    for (const [id, item] of Object.entries(oldItems)) {
      result.scopes[id] = { ...item, extraDirectories: [] }
    }
    result.scopeStates = {}
    for (const [id, state] of Object.entries(oldItemStates)) {
      result.scopeStates[id] = { scopeId: state.workspaceItemId }
    }
    result.chats = {}
    for (const [id, chat] of Object.entries(oldChats)) {
      const { workspaceItemId, ...rest } = chat as Record<string, unknown>
      result.chats[id] = { ...rest, scopeId: workspaceItemId }
    }
    result.sessions = {}
    for (const [id, session] of Object.entries(oldSessions)) {
      const { workspaceItemId, ...rest } = session as Record<string, unknown>
      result.sessions[id] = { ...rest, scopeId: workspaceItemId }
    }
    result.windowStates = {}
    for (const [id, ws] of Object.entries(oldWindowStates)) {
      const { selectedWorkspaceItemId, ...rest } = ws as Record<string, unknown>
      result.windowStates[id] = { ...rest, selectedScopeId: selectedWorkspaceItemId ?? null }
    }
    return result
  },
}

export default migration
