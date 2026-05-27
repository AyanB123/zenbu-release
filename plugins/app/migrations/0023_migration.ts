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
  version: 24,
  operations: [
    {
      "op": "alter",
      "key": "sessions",
      "changes": {
        "typeHash": {
          "from": "1a4e81c68d73be17",
          "to": "a100a91bd66110a7"
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    const result = apply(prev)
    // Backfill `archived` on existing sessions.
    const sessions = result.sessions as Record<string, any> | undefined
    if (sessions) {
      for (const id of Object.keys(sessions)) {
        const s = sessions[id]
        if (!s) continue
        if (typeof s.archived !== "boolean") s.archived = false
      }
    }
    return result
  },
}

export default migration
