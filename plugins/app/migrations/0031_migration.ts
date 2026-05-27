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
  version: 32,
  operations: [
    {
      "op": "alter",
      "key": "sessions",
      "changes": {
        "typeHash": {
          "from": "bd18429be1c163ce",
          "to": "296617e7fdcc451a"
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    const result = apply(prev)
    // Replace the per-kind `runStartTokens` snapshot with a single
    // `runStartContextTokens` number. There can't be an in-flight
    // agent run carried across a migration, so null is the only
    // valid initial value.
    const sessions = result.sessions ?? {}
    for (const id of Object.keys(sessions)) {
      const s = sessions[id]
      if (!s) continue
      if ("runStartTokens" in s) delete s.runStartTokens
      if (s.runStartContextTokens === undefined) {
        s.runStartContextTokens = null
      }
    }
    return result
  },
}

export default migration
