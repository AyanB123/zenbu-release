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
  version: 13,
  operations: [
    {
      "op": "alter",
      "key": "sessions",
      "changes": {
        "typeHash": {
          "from": "d10167c32ef4beab",
          "to": "c506534f625253cc"
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    const result = apply(prev)
    if (result?.sessions) {
      for (const s of Object.values<any>(result.sessions)) {
        if (s && s.branchSummary === undefined) s.branchSummary = null
      }
    }
    return result
  },
}

export default migration
