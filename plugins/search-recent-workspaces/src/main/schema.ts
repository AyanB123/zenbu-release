import { createSchema, z } from "@zenbujs/core/db"

/**
 * Per-workspace last-visited timestamp (epoch ms). Stamped by
 * `SearchRecentWorkspacesService` whenever a window transitions
 * its active view to a workspace it wasn't on previously.
 *
 * Workspaces that have never been visited under this plugin's
 * lifetime simply aren't in the map; the palette falls back to
 * `workspace.createdAt` so they still sort sensibly below visited
 * ones.
 */
export default createSchema({
  lastVisitedAt: z.record(z.string(), z.number()).default({}),
})
