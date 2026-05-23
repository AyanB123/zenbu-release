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
  version: 50,
  operations: [
    {
      "op": "alter",
      "key": "scopes",
      "changes": {
        "typeHash": {
          "from": "dd79c419c49e8b88",
          "to": "25a46621edcc3d67"
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    const result = apply(prev)
    // Backfill `pluginName` on pre-existing scopes. Zod's default
    // handles fresh inserts; older scopes need an explicit null so
    // sidebar checks like `scope.pluginName != null` don't see
    // `undefined`.
    const scopes = result.scopes as Record<string, any> | undefined
    if (scopes) {
      for (const s of Object.values(scopes)) {
        if ((s as any).pluginName === undefined) {
          ;(s as any).pluginName = null
        }
      }
    }
    return result
  },
}

export default migration
