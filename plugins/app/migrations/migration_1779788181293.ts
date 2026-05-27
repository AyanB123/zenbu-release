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
  version: 72,
  operations: [
    {
      "op": "alter",
      "key": "workspaces",
      "changes": {
        "typeHash": {
          "from": "615617315f33bb4e",
          "to": "f7089c97ed9f7294"
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    const result = apply(prev)
    // Drop the deprecated `workspace.sentinel` field. The previous
    // migration backfilled `kind: "plugin"` from `sentinel: true`,
    // so by the time this runs every row's flavor is already
    // captured in `kind` — the field has no readers left.
    const workspaces = result?.workspaces
    if (workspaces && typeof workspaces === "object") {
      for (const id of Object.keys(workspaces)) {
        const w = workspaces[id]
        if (w && "sentinel" in w) {
          delete w.sentinel
        }
      }
    }
    return result
  },
}

export default migration
