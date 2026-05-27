import { collection, createSchema, z } from "@zenbujs/core/db"

const playLogItem = z.object({
  ts: z.number(),
  stream: z.enum(["stdout", "stderr", "system"]),
  data: z.string(),
  runId: z.string(),
})

/**
 * Per-workspace play-button config + live run state.
 *
 * `setupCompletedScopeIds` is per-scope because each worktree has
 * its own directory (e.g. `pnpm install` writes `node_modules/`
 * into the scope's dir, not the workspace's). Changing
 * `setupCommand` clears the list. `null` setup = "setup not
 * needed".
 *
 * `isRunning` / `currentRunId` are runtime mirrors that
 * `PlayService.evaluate()` resets to false/null on startup —
 * the in-memory `live` map starts empty so the prior session's
 * Stop state is meaningless.
 */
export const playConfig = z.object({
  workspaceId: z.string(),
  setupCommand: z.string().nullable().default(null),
  startCommand: z.string().default(""),
  setupCompletedScopeIds: z.array(z.string()).default([]),
  isRunning: z.boolean().default(false),
  currentRunId: z.string().nullable().default(null),
  currentRunStartedAt: z.number().nullable().default(null),
  logs: collection(playLogItem, { debugName: "play-logs" }),
})

/**
 * Play plugin's DB section.
 *
 * Single record `configs` keyed by workspaceId — same shape the
 * host's `root.app.playConfigs` carried before isolation. The
 * host's matching slot is dropped by `app` migration `0046`.
 */
export default createSchema({
  configs: z.record(z.string(), playConfig).default({}),
})
