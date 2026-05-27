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
  version: 4,
  operations: [
    {
      "op": "alter",
      "key": "sessions",
      "changes": {
        "typeHash": {
          "from": "cacdc7d8e35e5f44",
          "to": "49b26c92d9d0c6b7"
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    const result = apply(prev)
    if (result.sessions && typeof result.sessions === "object") {
      for (const session of Object.values(result.sessions) as Array<Record<string, unknown>>) {
        if (typeof session.leafCount !== "number") session.leafCount = 1
      }
    }
    return result
  },
}

export default migration
