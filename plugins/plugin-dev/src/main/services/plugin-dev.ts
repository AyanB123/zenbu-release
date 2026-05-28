import { type ChildProcess } from "node:child_process"
import fs from "node:fs"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { nanoid } from "nanoid"
import { Service } from "@zenbujs/core/runtime"
import {
  BaseWindowService,
  DbService,
  RpcService,
  ViewRegistryService,
  WindowService,
} from "@zenbujs/core/services"
import type { InferSchemaRoot } from "@zenbujs/core/db"
import {
  patchLocalPlugins,
  findProjectRoot,
} from "@hackable-gui/plugin-installer/lib/patch-local-plugins"
import pluginDevSchema from "../schema"

type PluginDevRun =
  InferSchemaRoot<typeof pluginDevSchema>["runs"][string]

const here = path.dirname(fileURLToPath(import.meta.url))
const VIEW_SOURCE = path.resolve(here, "../../views/plugin-dev-buttons.tsx")
const VIEW_TYPE = "plugin-dev-buttons"

/** Cross-process onboarding preferences. Lives in `~/.zenbu/.internal/`
 * so it's shared between the parent host and any sandboxed dev
 * child (which has its own DB but the same `$HOME`). The two
 * modals ("plugin workspace" + "plugin dev") each have their own
 * dismissed flag here. JSON is fine — file is read on modal
 * mount and written on dismiss; no concurrency to worry about. */
const PREFS_PATH = path.join(
  os.homedir(),
  ".zenbu",
  ".internal",
  "plugin-dev-prefs.json",
)

export type ModalKey = "workspace" | "dev"
export type ModalPrefs = {
  dismissedWorkspaceModal: boolean
  dismissedDevModal: boolean
}

const DEFAULT_PREFS: ModalPrefs = {
  dismissedWorkspaceModal: false,
  dismissedDevModal: false,
}

/** Argv flag set by `runInDev` on the spawned child instance so it
 * can self-identify as a dev sandbox. Read once at boot in
 * `evaluate()` and persisted into this plugin's `devMode` field. */
const DEV_MODE_ARGV = "--zen-plugin-dev=1"

/** Same flush cadence the play plugin uses \u2014 short enough to feel
 * live while batching enough writes that a chatty child doesn't
 * thrash the DB. */
const LOG_FLUSH_MS = 80
/** Bound the captured-stderr tail we attach to the error event. The
 * full output stays in the logs collection. */
const ERROR_TAIL_BYTES = 4096

type LogEntry = {
  ts: number
  stream: "stdout" | "stderr" | "system"
  data: string
  runId: string
}

type LiveRun = {
  runId: string
  pluginPath: string
  child: ChildProcess
  pendingLogs: LogEntry[]
  flushTimer: ReturnType<typeof setTimeout> | null
  stderrTail: string
  /** Set once the renderer subscriber has a chance to attach
   * (one microtask after `runInDev` returns) so the first
   * `pluginDevRunStart` event isn't dropped. */
  startEmitted: boolean
}

/**
 * Plugin-dev main service.
 *
 * Two RPCs + one title-bar view registration. See
 * `plugin-dev-buttons.tsx` for the renderer half.
 *
 *  - **`runInDev`**: spawns a new Electron process
 *    (`process.execPath`) with the current host's argv plus
 *    `--plugin=<manifest>`. The framework's `loadConfig` honours
 *    the flag and loads the plugin alongside the configured set.
 *    Output from the child is streamed into the plugin's own
 *    `runs.<id>.logs` collection so the title-bar popover can
 *    render a scrollback even after the child has exited.
 *  - **`installLocal`**: writes the plugin's manifest path into
 *    the user's `zenbu.local.ts` overlay. Reuses
 *    `plugin-installer`'s patch helper.
 *
 * Both methods resolve a directory or manifest path; passing the
 * plugin's source directory is the common case.
 */
export class PluginDevService extends Service.create({
  key: "pluginDev",
  deps: {
    rpc: RpcService,
    db: DbService,
    viewRegistry: ViewRegistryService,
    // `window.respawnSelf` is the framework primitive that knows
    // how to launch a fresh instance of the host in either dev or
    // production, with isolated user-data-dir and DB sandbox. We
    // intentionally don't spawn `process.execPath` ourselves —
    // that runs into Electron's `SingletonLock` and corrupts the
    // parent's kyju DB.
    window: WindowService,
    // We peek the parent's main-window bounds before spawning so
    // the child opens slightly offset (down-and-right) instead of
    // landing on top of the parent. Without this the user sees
    // "the app blinked" instead of "a new window appeared".
    baseWindow: BaseWindowService,
  },
}) {
  /** Active runs keyed by runId, used to look up the right
   * collection to write into and the right child to kill on
   * teardown. Cleared on exit. */
  private readonly live = new Map<string, LiveRun>()

  async evaluate() {
    this.setup("register-view", () => {
      void this.ctx.viewRegistry.registerView({
        type: VIEW_TYPE,
        rendering: "component",
        source: { modulePath: VIEW_SOURCE },
        meta: {
          // Sits to the left of `open-in` (titleBarOrder: 1) and
          // `play` (titleBarOrder: 2). Negative on purpose so
          // future built-ins land between us and them without
          // renumbering.
          kind: "title-bar",
          titleBarOrder: 0,
          label: "Plugin dev",
        },
      })
      return () => {
        void this.ctx.viewRegistry.unregisterView(VIEW_TYPE)
      }
    })

    // Inject the onboarding modals + dev-mode border overlay into
    // every entrypoint window. The script itself decides whether
    // to render based on `useDb(root => root.pluginDev.devMode)`
    // and the active workspace's kind, so a normal workspace
    // window pays only the mount cost.
    this.setup("inject-modals", () =>
      this.injectContentScript({
        view: "entrypoint",
        modulePath: "src/content/plugin-dev-modals.tsx",
      }),
    )

    // Self-identify as a dev-sandbox instance if the launcher
    // passed our argv flag. Persisted into this plugin's own DB
    // section (which lives in the child's sandbox DB — not the
    // parent's), so it's a per-instance fact the renderer can
    // read synchronously.
    if (process.argv.includes(DEV_MODE_ARGV)) {
      await this.ctx.db.client.update(root => {
        root.pluginDev.devMode = true
      })
    }

    this.setup("kill-on-dispose", () => async () => {
      const entries = [...this.live.values()]
      this.live.clear()
      for (const entry of entries) {
        try {
          entry.child.kill()
        } catch {}
      }
    })
  }

  // ---------- modal prefs RPC ---------------------------------------------

  /** Read the shared dismissed-modal state. The renderer modals
   * call this on mount to decide whether to render. */
  async getModalPrefs(): Promise<ModalPrefs> {
    try {
      const raw = await fsp.readFile(PREFS_PATH, "utf-8")
      const parsed = JSON.parse(raw) as Partial<ModalPrefs>
      return {
        dismissedWorkspaceModal: !!parsed.dismissedWorkspaceModal,
        dismissedDevModal: !!parsed.dismissedDevModal,
      }
    } catch {
      return { ...DEFAULT_PREFS }
    }
  }

  /** Persist a "don't show again" choice. Both the parent host
   * and any dev sandbox share the same `$HOME`, so writing here
   * sticks across both instance kinds. */
  async dismissModal(args: { key: ModalKey }): Promise<ModalPrefs> {
    const current = await this.getModalPrefs()
    const next: ModalPrefs = {
      ...current,
      ...(args.key === "workspace"
        ? { dismissedWorkspaceModal: true }
        : { dismissedDevModal: true }),
    }
    await fsp.mkdir(path.dirname(PREFS_PATH), { recursive: true })
    await fsp.writeFile(PREFS_PATH, JSON.stringify(next, null, 2))
    return next
  }

  /**
   * Spawn a fresh host instance with `--plugin=<manifest>`. The
   * argument is resolved using the same rules `loadConfig` applies:
   * if `pluginPath` is a directory, we look for a
   * `zenbu.plugin.{ts,js,mjs}` inside it; otherwise we treat it as
   * the manifest itself.
   *
   * On synchronous validation failure (missing path, no manifest
   * in directory), we throw \u2014 the caller's `try/catch` in the
   * renderer turns it into a toast. Asynchronous failure (child
   * exits non-zero shortly after spawn) ends up as a `system`
   * log line plus a `pluginDevRunError` event so the renderer
   * can both surface the toast AND show the user the
   * full output in the logs popover.
   */
  async runInDev(args: { pluginPath: string }): Promise<{ runId: string }> {
    const manifestPath = resolveManifestPath(args.pluginPath)
    // Both the renderer and the service need a stable key for the
    // "latest run" index. The renderer passes the plugin's source
    // *directory* (`scope.directory`); the service resolves it to
    // the manifest *file*. Keying by directory means the renderer's
    // lookup matches the service's write without either side
    // having to know about the other's normalization.
    const pluginDirKey = path.dirname(manifestPath)

    const runId = nanoid()
    const emit = this.ctx.rpc.emit.app

    // Delegate to the framework. `isolateUserData` mints a fresh
    // tmpdir for the child's `--user-data-dir` + `--zen-db-path`
    // so it doesn't deadlock on the parent's Electron singleton
    // lock or fight over the kyju DB. `respawnSelf` also strips
    // prior `--plugin=` flags before re-applying ours, so
    // re-launching from inside a dev instance doesn't pile them
    // up.
    //
    // `windowBounds` offsets the child window down-and-right from
    // the focused parent window so the user sees a distinct new
    // window land instead of "the same window just blanked out".
    // The framework forwards these as `--zen-x/--zen-y/...` flags
    // that `BaseWindowService` picks up on first window creation.
    const parentBounds = this.ctx.baseWindow.windows
      .get("main")
      ?.getBounds()
    const offset = 48
    const windowBounds = parentBounds
      ? {
          x: parentBounds.x + offset,
          y: parentBounds.y + offset,
          width: parentBounds.width,
          height: parentBounds.height,
        }
      : undefined

    const respawn = this.ctx.window.respawnSelf({
      extraArgv: [`--plugin=${manifestPath}`, DEV_MODE_ARGV],
      isolateUserData: true,
      stdio: "pipe",
      windowBounds,
    })
    const child: ChildProcess = respawn.child

    const entry: LiveRun = {
      runId,
      pluginPath: manifestPath,
      child,
      pendingLogs: [],
      flushTimer: null,
      stderrTail: "",
      startEmitted: false,
    }
    this.live.set(runId, entry)

    // Materialize the run record + logs collection ref BEFORE we
    // start emitting events. The renderer reads
    // `root.pluginDev.runs[runId].logs` to bind the popover's
    // scrollback, so the record has to exist by the time the
    // user clicks "Open logs".
    const now = Date.now()
    await this.ctx.db.client.update(root => {
      root.pluginDev.runs[runId] = {
        runId,
        pluginPath: manifestPath,
        startedAt: now,
        endedAt: null,
        status: "running",
        exitCode: null,
        errorMessage: null,
        // Materialize the logs collection ref by hand so the
        // service can call `concat()` on it immediately. Same
        // pattern as `play.ts` — the schema's collection helper
        // gives kyju the type info, but the runtime ref shape
        // (`{ collectionId, debugName }`) has to be written
        // explicitly the first time we touch the record.
        logs: {
          collectionId: nanoid(),
          debugName: `plugin-dev-logs-${runId}`,
        } as PluginDevRun["logs"],
      }
      root.pluginDev.latestRunIdByPluginPath[pluginDirKey] = runId
    })

    this.appendSystem(
      entry,
      `\u25b6 spawning ${respawn.execPath} (pid pending)\u2026`,
    )
    this.appendSystem(entry, `   argv: ${respawn.argv.join(" ")}`)
    if (respawn.sandboxDir) {
      this.appendSystem(entry, `   sandbox: ${respawn.sandboxDir}`)
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      this.appendStream(entry, "stdout", chunk.toString("utf-8"))
    })
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8")
      entry.stderrTail = (entry.stderrTail + text).slice(-ERROR_TAIL_BYTES)
      this.appendStream(entry, "stderr", text)
    })
    child.on("error", err => {
      const message = err instanceof Error ? err.message : String(err)
      this.appendSystem(entry, `\u2717 spawn error: ${message}`)
      emit.pluginDevRunError({
        runId,
        pluginPath: manifestPath,
        message,
      })
      void this.finalize(entry, {
        status: "errored",
        exitCode: null,
        errorMessage: message,
      })
    })
    child.on("exit", (code, signal) => {
      const exitCode = code
      const ok = (code ?? 1) === 0
      this.appendSystem(
        entry,
        ok
          ? `\u2713 exited cleanly (code 0)`
          : `\u2717 exited with ${
              signal ? `signal ${signal}` : `code ${code ?? "null"}`
            }`,
      )
      void this.finalize(entry, {
        status: ok ? "exited" : "errored",
        exitCode: exitCode,
        errorMessage: ok
          ? null
          : entry.stderrTail.trim() ||
            `Plugin dev instance exited with code ${code ?? "null"}.`,
      })
      emit.pluginDevRunExit({ runId, exitCode: code })
      if (!ok) {
        emit.pluginDevRunError({
          runId,
          pluginPath: manifestPath,
          message:
            entry.stderrTail.trim() ||
            `Plugin dev instance exited with code ${code ?? "null"}.`,
        })
      }
    })

    // Now that the child is alive (or at least past the synchronous
    // spawn(2) step), surface the pid + tell the renderer the run
    // is officially up.
    if (child.pid !== undefined) {
      this.appendSystem(entry, `   pid: ${child.pid}`)
    }
    queueMicrotask(() => {
      if (entry.startEmitted) return
      entry.startEmitted = true
      // Only fire start if we haven't already exited / errored in
      // the meantime; the error/exit handlers above own the
      // failure event.
      if (this.live.has(runId)) {
        emit.pluginDevRunStart({ runId, pluginPath: manifestPath })
      }
    })

    return { runId }
  }

  /**
   * Stop a still-running dev instance. The renderer wires this
   * to the title-bar "Stop" affordance the button morphs into
   * while a run is live, so the user can pause and re-launch
   * without spawning a second sandboxed instance on top.
   *
   * Sends SIGTERM first to give the child a chance to clean up;
   * the `child.on("exit")` handler installed in `runInDev`
   * finalizes the DB record and emits the usual exit events.
   * Returns `{ ok: false }` if the run is already gone so the
   * renderer can treat double-clicks as no-ops.
   */
  async stopDev(args: { runId: string }): Promise<{ ok: boolean }> {
    const entry = this.live.get(args.runId)
    if (!entry) return { ok: false }
    try {
      entry.child.kill("SIGTERM")
      return { ok: true }
    } catch (err) {
      console.error("[plugin-dev] kill failed:", err)
      return { ok: false }
    }
  }

  /**
   * Append the plugin's manifest path to the user's `zenbu.local.ts`
   * overlay. The framework's loader watches that file and re-loads
   * the plugin set on edit, so the new entry takes effect without
   * a manual restart.
   */
  async installLocal(args: { pluginPath: string }): Promise<{
    ok: true
    manifestPath: string
    projectDir: string
  }> {
    const manifestPath = resolveManifestPath(args.pluginPath)
    const projectDir = findProjectRoot()
    try {
      await patchLocalPlugins(projectDir, manifestPath)
      this.ctx.rpc.emit.app.pluginDevInstallDone({
        pluginPath: manifestPath,
        ok: true,
      })
      return { ok: true, manifestPath, projectDir }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.ctx.rpc.emit.app.pluginDevInstallDone({
        pluginPath: manifestPath,
        ok: false,
        error: message,
      })
      throw err
    }
  }

  // ---------- log streaming -----------------------------------------------

  private appendStream(
    entry: LiveRun,
    stream: "stdout" | "stderr",
    data: string,
  ): void {
    if (data.length === 0) return
    entry.pendingLogs.push({
      ts: Date.now(),
      stream,
      data,
      runId: entry.runId,
    })
    this.scheduleFlush(entry)
  }

  private appendSystem(entry: LiveRun, data: string): void {
    entry.pendingLogs.push({
      ts: Date.now(),
      stream: "system",
      data,
      runId: entry.runId,
    })
    this.scheduleFlush(entry)
  }

  private scheduleFlush(entry: LiveRun): void {
    if (entry.flushTimer) return
    entry.flushTimer = setTimeout(() => {
      entry.flushTimer = null
      void this.flush(entry)
    }, LOG_FLUSH_MS)
  }

  private async flush(entry: LiveRun): Promise<void> {
    if (entry.pendingLogs.length === 0) return
    const batch = entry.pendingLogs
    entry.pendingLogs = []
    try {
      await this.ctx.db.client.pluginDev.runs[entry.runId]?.logs?.concat(
        batch,
      )
    } catch (err) {
      console.error("[plugin-dev] logs.concat failed:", err)
    }
  }

  private async finalize(
    entry: LiveRun,
    args: {
      status: "exited" | "errored"
      exitCode: number | null
      errorMessage: string | null
    },
  ): Promise<void> {
    // Drain pending logs first so the final state record never
    // ships ahead of the last batch.
    if (entry.flushTimer) {
      clearTimeout(entry.flushTimer)
      entry.flushTimer = null
    }
    await this.flush(entry)
    await this.ctx.db.client.update(root => {
      const rec = root.pluginDev.runs[entry.runId]
      if (!rec) return
      rec.status = args.status
      rec.endedAt = Date.now()
      rec.exitCode = args.exitCode
      rec.errorMessage = args.errorMessage
    })
    this.live.delete(entry.runId)
  }
}

/**
 * Accept either a plugin directory or a manifest file. If a directory
 * is passed, look for the first `zenbu.plugin.{ts,mts,js,mjs,cjs}`
 * inside it. Throws with a clear message when the path doesn't exist
 * or no manifest can be found.
 */
function resolveManifestPath(input: string): string {
  if (typeof input !== "string" || input.length === 0) {
    throw new Error("pluginPath is required")
  }
  const abs = path.isAbsolute(input)
    ? input
    : path.resolve(process.cwd(), input)
  let stat: fs.Stats | null = null
  try {
    stat = fs.statSync(abs)
  } catch {
    throw new Error(`pluginPath does not exist: ${abs}`)
  }
  if (stat.isFile()) return abs
  if (stat.isDirectory()) {
    const candidates = [
      "zenbu.plugin.ts",
      "zenbu.plugin.mts",
      "zenbu.plugin.js",
      "zenbu.plugin.mjs",
      "zenbu.plugin.cjs",
    ]
    for (const name of candidates) {
      const candidate = path.join(abs, name)
      if (fs.existsSync(candidate)) return candidate
    }
    throw new Error(
      `pluginPath has no zenbu.plugin.{ts,js,\u2026}: ${abs}`,
    )
  }
  throw new Error(`pluginPath is neither a file nor a directory: ${abs}`)
}
