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
  version: 53,
  operations: [
    {
      "op": "alter",
      "key": "workspaces",
      "changes": {
        "typeHash": {
          "from": "06d8a1079274d27a",
          "to": "03ffdb9e817efac1"
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    const result = apply(prev)
    // Added optional `defaultWorktreeBranch` (string|null) to each
    // workspace. Backfill existing workspaces with `null` so the
    // create-worktree dialog falls back to the main worktree's
    // current branch (the previous behaviour).
    const workspaces = result.workspaces as
      | Record<string, any>
      | undefined
    if (workspaces) {
      for (const ws of Object.values(workspaces)) {
        const w = ws as Record<string, unknown>
        if (w.defaultWorktreeBranch === undefined) {
          w.defaultWorktreeBranch = null
        }
      }
    }
    return result
  },
}

export default migration
