import { createSchema, z } from "@zenbujs/core/db";

/** Minimal status entry — just what the sidebar tree needs to render
 * paths + per-row decorations. Intentionally a subset of the host's
 * `GitFileStatus` (no numstat, no staged/unstaged split): the sidebar
 * doesn't show counts or stage state, and re-running `git diff
 * --numstat` on every poll would be wasted work. */
const gitFileEntry = z.object({
  path: z.string(),
  /** Porcelain XY code, e.g. " M", "A ", "MM", "??". */
  code: z.string(),
  untracked: z.boolean(),
});

const indexStatus = z.enum(["polling", "idle", "error"]);

/** Per-scope status snapshot. Written on demand by `GitStatusService.refresh`;
 * the view keeps showing the last good `files` list until a refresh lands. */
const gitTreeStatus = z.object({
  scopeId: z.string(),
  directory: z.string(),
  isRepo: z.boolean(),
  files: z.array(gitFileEntry),
  status: indexStatus,
  error: z.string().nullable(),
  /** ms since epoch of the last successful refresh. */
  updatedAt: z.number(),
});

export default createSchema({
  statuses: z.record(z.string(), gitTreeStatus).default({}),
});
