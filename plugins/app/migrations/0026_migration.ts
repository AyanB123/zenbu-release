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
  version: 27,
  operations: [
    {
      "op": "alter",
      "key": "windowStates",
      "changes": {
        "typeHash": {
          "from": "b3409bfed4cd2d3b",
          "to": "b794b548f51cf0a7"
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    const result = apply(prev)
    // Backfill new bottomPanelView field on every existing windowState
    // so the hooks can read it without an `?? null` dance.
    if (result.windowStates && typeof result.windowStates === "object") {
      for (const ws of Object.values(result.windowStates) as any[]) {
        if (ws && typeof ws === "object" && !("bottomPanelView" in ws)) {
          ws.bottomPanelView = null
        }
      }
    }
    return result
  },
}

export default migration
