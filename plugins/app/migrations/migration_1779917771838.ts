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
  version: 75,
  operations: [
    {
      "op": "alter",
      "key": "windowStates",
      "changes": {
        "typeHash": {
          "from": "a1ed7fdba0439e6e",
          "to": "a3bcc97591c76fec"
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    const result = apply(prev)
    const windowStates = result.windowStates as
      | Record<string, any>
      | undefined
    if (windowStates) {
      for (const ws of Object.values(windowStates)) {
        if (ws && typeof ws === "object" && ws.fullscreen === undefined) {
          ws.fullscreen = false
        }
      }
    }
    return result
  },
}

export default migration
