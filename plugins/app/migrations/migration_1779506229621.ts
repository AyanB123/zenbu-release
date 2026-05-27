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
  version: 48,
  operations: [
    {
      "op": "alter",
      "key": "scopes",
      "changes": {
        "typeHash": {
          "from": "3bb8074d7ef22273",
          "to": "dd79c419c49e8b88"
        }
      }
    }
  ],
  migrate(prev, { apply }) {
    const result = apply(prev)
    // Backfill the new pin metadata on existing scope records.
    //
    // Pass 1: initialize both new fields. `pinnedAt` gets a
    // first-pass value based on the repo's main worktree so the
    // canonical anchor row pins itself retroactively. `unpinnedAt`
    // starts null — nothing has ever been unpinned before this
    // migration ran.
    //
    // Pass 2: walk workspaces and guarantee each one ends up with
    // at least one pinned scope. Workspaces whose scopes don't
    // include the repo's main worktree (e.g. pointed at a
    // secondary worktree, or a non-git directory) would otherwise
    // come out with zero pins, which the user perceives as a bug:
    // they want a default anchor at the top no matter what. The
    // fallback is the oldest visible scope (smallest `createdAt`),
    // which is by definition "the first thing this workspace was
    // ever about".
    const scopes = result.scopes as Record<string, any> | undefined
    const repos = result.repos as Record<string, any> | undefined
    if (scopes) {
      for (const s of Object.values(scopes)) {
        const scope = s as Record<string, unknown>
        if (scope.unpinnedAt === undefined) scope.unpinnedAt = null
        if (scope.pinnedAt === undefined) {
          const repoId = scope.repoId as string | null | undefined
          const repo = repoId && repos ? repos[repoId] : null
          const mainPath = repo?.mainWorktreePath as string | undefined
          const isMain =
            !!mainPath && (scope.directory as string | undefined) === mainPath
          scope.pinnedAt = isMain ? (scope.createdAt as number) : null
        }
      }
      // Pass 2: per-workspace fallback. Bucket non-archived,
      // non-completed scopes by workspace and pin the oldest one
      // if the bucket has no pin yet. We intentionally ignore
      // archived/completed scopes here because pinning a hidden
      // scope wouldn't give the user the visible anchor row they
      // expect.
      const byWorkspace = new Map<string, Record<string, unknown>[]>()
      for (const s of Object.values(scopes)) {
        const scope = s as Record<string, unknown>
        if (scope.archived === true) continue
        if (scope.completed === true) continue
        const wsId = scope.workspaceId as string | undefined
        if (!wsId) continue
        const arr = byWorkspace.get(wsId) ?? []
        arr.push(scope)
        byWorkspace.set(wsId, arr)
      }
      for (const bucket of byWorkspace.values()) {
        const anyPinned = bucket.some(s => s.pinnedAt != null)
        if (anyPinned) continue
        let oldest: Record<string, unknown> | null = null
        for (const s of bucket) {
          if (
            !oldest ||
            (s.createdAt as number) < (oldest.createdAt as number)
          ) {
            oldest = s
          }
        }
        if (oldest) oldest.pinnedAt = oldest.createdAt as number
      }
    }
    return result
  },
}

export default migration
