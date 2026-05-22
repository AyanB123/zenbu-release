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
  version: 35,
  operations: [
    {
      "op": "alter",
      "key": "summaries",
      "changes": {
        "typeHash": {
          "from": "74ddccd78f5a2945",
          "to": "69a360cbd36d0925"
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    const result = apply(prev)
    // Summaries are now keyed by `sessionId` instead of `entryId`, and
    // the `entryId` field has been dropped. Old entries are stale
    // (wrong key) — just drop them all. They'll regenerate on the
    // next prompt in each session.
    result.summaries = {}
    return result
  },
}

export default migration
