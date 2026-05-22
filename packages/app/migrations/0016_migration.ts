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
  version: 17,
  operations: [
    {
      "op": "alter",
      "key": "workspaces",
      "changes": {
        "typeHash": {
          "from": "6a48a3cc6191a3a5",
          "to": "7b1aafbcbf2ad5c4"
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    const result = apply(prev)
    for (const ws of Object.values(result.workspaces ?? {}) as any[]) {
      if (ws.archived == null) ws.archived = false
    }
    return result
  },
}

export default migration
