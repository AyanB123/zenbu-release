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
  version: 42,
  operations: [
    {
      "op": "alter",
      "key": "workspaces",
      "changes": {
        "typeHash": {
          "from": "7b1aafbcbf2ad5c4",
          "to": "06d8a1079274d27a"
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    const result = apply(prev)
    // Backfill the new `sentinel` flag on existing workspaces. The
    // schema default handles fresh inserts; this fills in records
    // that pre-date the field so the new sort logic doesn't have
    // to treat `undefined` as a separate case.
    const workspaces = result.workspaces as Record<string, any> | undefined
    if (workspaces) {
      for (const ws of Object.values(workspaces)) {
        if ((ws as any).sentinel === undefined) {
          ;(ws as any).sentinel = false
        }
      }
    }
    return result
  },
}

export default migration
