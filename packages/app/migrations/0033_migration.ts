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
  version: 34,
  operations: [
    {
      "op": "alter",
      "key": "sessions",
      "changes": {
        "typeHash": {
          "from": "296617e7fdcc451a",
          "to": "883fd169a98c801a"
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    const result = apply(prev)
    // Drop the `queuePaused` boolean and the per-item `status` field.
    // The queue is now a single "live, mirrored in pi" state, so the
    // notion of paused items doesn't exist anymore. Any items left
    // over from a previous boot are stale (pi process is gone) — the
    // boot reconciler in SessionsService.evaluate() drops them on
    // startup, so we don't need to filter here.
    const sessions = result.sessions ?? {}
    for (const id of Object.keys(sessions)) {
      const s = sessions[id]
      if (!s) continue
      if ("queuePaused" in s) delete s.queuePaused
      if (Array.isArray(s.queueDraft)) {
        for (const item of s.queueDraft) {
          if (item && "status" in item) delete item.status
        }
      }
    }
    return result
  },
}

export default migration
