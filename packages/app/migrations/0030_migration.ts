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
  version: 31,
  operations: [
    {
      "op": "alter",
      "key": "sessions",
      "changes": {
        "typeHash": {
          "from": "8413009331040996",
          "to": "bd18429be1c163ce"
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    const result = apply(prev)
    // New `runStartTokens` field: leave null on every existing
    // session. There can't be an in-flight agent run carried across
    // a migration (services tear down on reload), so null is the
    // only valid initial value.
    const sessions = result.sessions ?? {}
    for (const id of Object.keys(sessions)) {
      const s = sessions[id]
      if (s && s.runStartTokens === undefined) s.runStartTokens = null
    }
    return result
  },
}

export default migration
