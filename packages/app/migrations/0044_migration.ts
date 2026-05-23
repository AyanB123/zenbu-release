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
  version: 45,
  operations: [
    {
      "op": "alter",
      "key": "sessions",
      "changes": {
        "typeHash": {
          "from": "883fd169a98c801a",
          "to": "aa18db08fe4063bc"
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    const result = apply(prev)
    // Backfill the new `lastOpenedAt` / `lastCompletedAt` fields
    // on existing session records. The zod default handles fresh
    // inserts; pre-existing sessions need explicit nulls so the
    // unread-dot rule (`lastCompletedAt > (lastOpenedAt ?? 0)`)
    // doesn't see `undefined` and short-circuit.
    const sessions = result.sessions as Record<string, any> | undefined
    if (sessions) {
      for (const s of Object.values(sessions)) {
        if ((s as any).lastOpenedAt === undefined) {
          ;(s as any).lastOpenedAt = null
        }
        if ((s as any).lastCompletedAt === undefined) {
          ;(s as any).lastCompletedAt = null
        }
      }
    }
    return result
  },
}

export default migration
