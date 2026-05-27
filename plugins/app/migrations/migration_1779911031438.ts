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
  version: 73,
  operations: [
    {
      "op": "alter",
      "key": "scopes",
      "changes": {
        "typeHash": {
          "from": "25a46621edcc3d67",
          "to": "3f50bf2c5502b79a"
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    const result = apply(prev)
    // Fold the deprecated `completed` bucket into `archived`. The
    // previous shape had two parallel flags (`archived` /
    // `completed`); the new shape has only `archived`. Any row
    // that was previously "completed" gets surfaced as archived
    // so the user doesn't lose access to shelved worktrees, and
    // we use the row's `completedAt` stamp as the archive
    // timestamp when one isn't already set.
    const scopes = result.scopes as Record<string, any> | undefined
    if (scopes) {
      for (const s of Object.values(scopes)) {
        const scope = s as Record<string, unknown>
        if (scope.completed === true) {
          scope.archived = true
          if (scope.archivedAt == null && scope.completedAt != null) {
            scope.archivedAt = scope.completedAt
          }
        }
        delete scope.completed
        delete scope.completedAt
      }
    }
    return result
  },
}

export default migration
