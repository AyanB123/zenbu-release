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
  version: 19,
  operations: [
    {
      "op": "alter",
      "key": "sessions",
      "changes": {
        "typeHash": {
          "from": "42d4afceb802f179",
          "to": "1a4e81c68d73be17"
        }
      }
    },
    {
      "op": "alter",
      "key": "windowStates",
      "changes": {
        "typeHash": {
          "from": "10f95e639de0eddc",
          "to": "aba2eec7172ed33e"
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    const result = apply(prev)
    // Backfill `leftSidebarTab` on existing window states.
    const windowStates = result.windowStates as Record<string, any> | undefined
    if (windowStates) {
      for (const id of Object.keys(windowStates)) {
        const ws = windowStates[id]
        if (!ws) continue
        if (ws.leftSidebarTab == null) ws.leftSidebarTab = "agent"
      }
    }
    // Backfill `queueDraft` and `queuePaused` on existing sessions
    // (added to schema in a prior commit without a migration).
    const sessions = result.sessions as Record<string, any> | undefined
    if (sessions) {
      for (const id of Object.keys(sessions)) {
        const s = sessions[id]
        if (!s) continue
        if (!Array.isArray(s.queueDraft)) s.queueDraft = []
        if (typeof s.queuePaused !== "boolean") s.queuePaused = false
      }
    }
    return result
  },
}

export default migration
