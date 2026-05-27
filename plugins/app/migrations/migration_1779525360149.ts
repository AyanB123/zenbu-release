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
  version: 51,
  operations: [
    {
      "op": "alter",
      "key": "playConfigs",
      "changes": {
        "typeHash": {
          "from": "9b7c15ba37b6806e",
          "to": "8a5d0f5e66ed312a"
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    const result = apply(prev)
    // Old shape:  playConfig.setupCompleted: boolean
    // New shape:  playConfig.setupCompletedScopeIds: string[]
    //
    // We can't recover which scope(s) the old `setupCompleted=true`
    // flag was earned in — the schema didn't track that. The safest
    // backfill is an empty list: every scope re-runs setup once on
    // next click, which is exactly the bug this migration was made
    // to fix in the first place. Pre-existing scopes that were
    // already working don't lose data, they just pay one extra
    // setup run.
    const playConfigs = result.playConfigs as
      | Record<string, any>
      | undefined
    if (playConfigs) {
      for (const cfg of Object.values(playConfigs)) {
        const c = cfg as Record<string, unknown>
        delete c.setupCompleted
        if (!Array.isArray(c.setupCompletedScopeIds)) {
          c.setupCompletedScopeIds = []
        }
      }
    }
    return result
  },
}

export default migration
