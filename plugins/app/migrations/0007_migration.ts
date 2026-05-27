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
  version: 8,
  operations: [
    {
      "op": "add",
      "key": "terminals",
      "kind": "data",
      "hasDefault": true,
      "default": {}
    },
    {
      "op": "alter",
      "key": "windowStates",
      "changes": {
        "typeHash": {
          "from": "b649f06679a080ca",
          "to": "10f95e639de0eddc"
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    const result = apply(prev)
    const windows = (result.windowStates ?? {}) as Record<
      string,
      { scopeLastTerminal?: Record<string, string> }
    >
    for (const ws of Object.values(windows)) {
      if (!ws.scopeLastTerminal) ws.scopeLastTerminal = {}
    }
    return result
  },
}

export default migration
