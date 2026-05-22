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
  version: 29,
  operations: [
    {
      "op": "alter",
      "key": "windowStates",
      "changes": {
        "typeHash": {
          "from": "b794b548f51cf0a7",
          "to": "89215dae5f416d8c"
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    const result = apply(prev)
    // Fill in the new sidebar/panel open fields on every existing
    // per-window record so reload reads the persisted values right
    // away instead of waiting for the first interaction to write
    // them.
    const windowStates = result.windowStates ?? {}
    for (const id of Object.keys(windowStates)) {
      const ws = windowStates[id]
      if (!ws) continue
      if (ws.leftSidebarOpen === undefined) ws.leftSidebarOpen = true
      if (ws.rightSidebarOpenType === undefined) ws.rightSidebarOpenType = null
      if (ws.rightSidebarLastType === undefined) ws.rightSidebarLastType = null
      if (ws.bottomPanelOpen === undefined) ws.bottomPanelOpen = false
    }
    return result
  },
}

export default migration
