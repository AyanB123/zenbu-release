import { collection, createSchema, z } from "@zenbujs/core/db"

/**
 * One log line emitted by a Run-in-Dev child process.
 *
 * `stream`:
 *  - `"stdout"` / `"stderr"` come straight off the spawned
 *    Electron process's pipes.
 *  - `"system"` is the plugin-dev service's own framing (e.g.
 *    "spawned (pid=…)", "exited with code 1"). Rendered with a
 *    subtler colour so the user can tell it apart from real
 *    program output.
 */
const pluginDevLogItem = z.object({
  ts: z.number(),
  stream: z.enum(["stdout", "stderr", "system"]),
  data: z.string(),
  runId: z.string(),
})

/**
 * One Run-in-Dev session.
 *
 * Indexed by `runId` (the nanoid the service hands back to the
 * renderer) so the popover can look up its own run's logs
 * without re-keying when the user starts a second run. We keep
 * the previous runs around so the user can scroll back through
 * what their last attempt printed even after restarting.
 *
 * `status`:
 *  - `"running"`   \u2014 child is still alive
 *  - `"exited"`    \u2014 child exited with code 0
 *  - `"errored"`   \u2014 child exited non-zero OR `spawn` errored
 *                     synchronously. `exitCode === null` is
 *                     possible here (signal, ENOENT, etc.).
 */
const pluginDevRun = z.object({
  runId: z.string(),
  pluginPath: z.string(),
  startedAt: z.number(),
  endedAt: z.number().nullable().default(null),
  status: z.enum(["running", "exited", "errored"]).default("running"),
  exitCode: z.number().nullable().default(null),
  errorMessage: z.string().nullable().default(null),
  logs: collection(pluginDevLogItem, { debugName: "plugin-dev-logs" }),
})

/**
 * `latestRunIdByPluginPath` lets the title-bar button find the
 * current run for the active plugin without scanning every run
 * record. Updated by `runInDev` on spawn.
 *
 * `devMode` is flipped to true at boot when the host was launched
 * with `--zen-plugin-dev=1` (i.e. via `runInDev`). The renderer
 * reads it to know it's a dev-test instance so it can paint the
 * dashed yellow border + show the "this is a dev instance" modal.
 * It lives in this plugin's own DB section so the renderer can
 * `useDb` it without a round-trip.
 */
export default createSchema({
  runs: z.record(z.string(), pluginDevRun).default({}),
  latestRunIdByPluginPath: z
    .record(z.string(), z.string())
    .default({}),
  devMode: z.boolean().default(false),
})
