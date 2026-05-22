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
  version: 39,
  operations: [
    {
      "op": "alter",
      "key": "windowStates",
      "changes": {
        "typeHash": {
          "from": "1e4c5f257ffe405a",
          "to": "ffd58cee6dfa96d5"
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    const result = apply(prev)
    // Fill in the new `workspaceRailOpen` field on every existing
    // per-window record so reload reads the persisted value right
    // away instead of waiting for the first interaction to write
    // it.
    const windowStates = result.windowStates ?? {}
    for (const id of Object.keys(windowStates)) {
      const ws = windowStates[id]
      if (!ws) continue
      if (ws.workspaceRailOpen === undefined) ws.workspaceRailOpen = true
    }
    return result
  },
}

export default migration
