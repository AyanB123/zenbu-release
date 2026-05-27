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
  version: 47,
  operations: [
    {
      "op": "alter",
      "key": "scopes",
      "changes": {
        "typeHash": {
          "from": "e53bf45a08ff9104",
          "to": "3bb8074d7ef22273"
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    const result = apply(prev)
    // Backfill the new shelf metadata fields on existing scope
    // records. The zod defaults handle fresh inserts; pre-existing
    // scopes need explicit values so consumers (sidebar filter,
    // shelf popover) never see `undefined`.
    //
    //   - completed:  always starts false on legacy data.
    //   - archivedAt: we don't know when the user originally
    //     archived a scope, so set it to `Date.now()` for scopes
    //     that are currently archived (gives the shelf popover
    //     a deterministic sort key without inventing a fake
    //     historical timestamp), null otherwise.
    //   - completedAt: always null on legacy data — nothing was
    //     ever marked completed before this migration.
    const scopes = result.scopes as Record<string, any> | undefined
    if (scopes) {
      const now = Date.now()
      for (const s of Object.values(scopes)) {
        const scope = s as Record<string, unknown>
        if (scope.completed === undefined) scope.completed = false
        if (scope.completedAt === undefined) scope.completedAt = null
        if (scope.archivedAt === undefined) {
          scope.archivedAt = scope.archived === true ? now : null
        }
      }
    }
    return result
  },
}

export default migration
