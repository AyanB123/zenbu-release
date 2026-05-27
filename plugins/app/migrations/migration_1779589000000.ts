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

/**
 * Clear the bundled-PNG icon off the sentinel workspace so the new
 * inline `<SentinelIcon>` (a `currentColor`-driven plugin SVG)
 * renders instead.
 *
 * Before this migration the sentinel workspace boot path seeded
 * `~/.zenbu/.../sentinel-icon.png` as a workspace-icon blob. Now
 * `SentinelWorkspaceService` writes `icon: null` and the renderer
 * paints the plugin glyph inline via `WorkspaceIcon`'s
 * `isSentinel` branch \u2014 which gives us free light/dark adaptation
 * (the SVG uses `currentColor`) and avoids shipping a raster asset.
 *
 * For existing replicas we have to scrub the icon by hand: the
 * service is idempotent and won't touch a workspace it's already
 * created, so the blob reference would otherwise stick around.
 *
 * Rule:
 *   For every workspace with `sentinel === true` whose `icon` is
 *   still set, clear `icon` back to `null`. We deliberately do NOT
 *   delete the underlying blob \u2014 if the user later uploads a
 *   custom icon we'd be touching an unrelated blob, and the cost\n *   of leaving one tiny PNG blob behind is negligible. The blob is\n *   reachable by id from the renderer's `client.getBlobData` but\n *   nothing points at it once `icon` is cleared, so it's harmless.\n *\n * Idempotent \u2014 a re-run finds no sentinel workspaces with `icon`\n * still set and is a no-op.\n */
const migration: KyjuMigration = {
  version: 57,
  operations: [],
  migrate(prev, { apply }) {
    const result = apply(prev)
    const workspaces = result.workspaces as
      | Record<string, any>
      | undefined
    if (!workspaces) return result
    for (const ws of Object.values(workspaces)) {
      const w = ws as any
      if (!w || typeof w !== "object") continue
      if (w.sentinel !== true) continue
      if (w.icon == null) continue
      w.icon = null
    }
    return result
  },
}

export default migration
