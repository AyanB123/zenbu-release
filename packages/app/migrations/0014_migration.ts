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
  version: 15,
  operations: [
    {
      "op": "alter",
      "key": "sessions",
      "changes": {
        "typeHash": {
          "from": "c506534f625253cc",
          "to": "42d4afceb802f179"
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    const result = apply(prev)
    // Backfill the new `stats` field on existing sessions. Values will be
    // recomputed from pi the next time the session syncs runtime state.
    const sessions = result.sessions as Record<string, any> | undefined
    if (sessions) {
      for (const id of Object.keys(sessions)) {
        const s = sessions[id]
        if (!s) continue
        if (!s.stats) {
          s.stats = {
            tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            cost: 0,
            contextUsage: null,
            autoCompactionEnabled: true,
          }
        }
      }
    }
    return result
  },
}

export default migration
