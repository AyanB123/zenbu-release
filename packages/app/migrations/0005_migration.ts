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
  version: 6,
  operations: [
    {
      "op": "alter",
      "key": "workspaces",
      "changes": {
        "typeHash": {
          "from": "6e68869e636c2632",
          "to": "6a48a3cc6191a3a5"
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    const result = apply(prev)
    if (result.workspaces && typeof result.workspaces === "object") {
      for (const id of Object.keys(result.workspaces)) {
        const ws = result.workspaces[id]
        if (ws && typeof ws === "object" && !("icon" in ws)) {
          ws.icon = null
        }
      }
    }
    return result
  },
}

export default migration
