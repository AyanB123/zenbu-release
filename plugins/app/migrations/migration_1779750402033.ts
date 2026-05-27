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
  version: 66,
  operations: [
    {
      "op": "alter",
      "key": "fileTreeIndexes",
      "changes": {
        "typeHash": {
          "from": "5be79a98ec942832",
          "to": "43aae2a54f4955bb"
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    const result = apply(prev)
    const indexes = result.fileTreeIndexes
    if (!indexes || typeof indexes !== "object") return result
    // Existing indexes stored `paths` as a giant string[] inline in
    // root.json. Drop them so FileTreeService re-indexes each scope
    // into the new per-scope paths collection on next reconcile.
    for (const [scopeId, index] of Object.entries(indexes)) {
      if (!index || typeof index !== "object") {
        delete indexes[scopeId]
        continue
      }
      const paths = (index as { paths?: unknown }).paths
      if (Array.isArray(paths)) {
        delete indexes[scopeId]
      }
    }
    return result
  },
}

export default migration
