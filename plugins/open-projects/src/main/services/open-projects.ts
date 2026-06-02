import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { utilityProcess, type UtilityProcess } from "electron"
import { nanoid } from "nanoid"
import { Service } from "@zenbujs/core/runtime"
import { makeCollection } from "@zenbujs/core/db"
import {
  DbService,
  RpcService,
  ShortcutsService,
} from "@zenbujs/core/services"

const IS_MAC = process.platform === "darwin"

/**
 * Worker → service message types. Mirrors the protocol documented
 * at the top of `../workers/scan-projects.mjs`. Kept inline so we
 * don't have to ship a shared `.d.ts` alongside the worker.
 */
type ScanMessage =
  | {
      type: "batch"
      entries: Array<{
        path: string
        name: string
        parent: string
        depth: number
        marker: string
      }>
    }
  | { type: "done"; count: number; truncated: boolean }
  | { type: "error"; message: string }

/**
 * Owns the open-projects index + palette toggle plumbing.
 *
 * Three responsibilities:
 *
 *   1. **Indexing.** On boot (and on every hot-reload of this
 *      service) we fork an Electron utility process to walk
 *      `$HOME` looking for project folders. The worker streams
 *      batches back over `postMessage`; we forward them into the
 *      replicated collection at
 *      `db.openProjects.index.projects` so the renderer-side
 *      palette can read them via `useCollection`. The walk
 *      respects `IGNORE_DIRS`, a depth cap, a per-dir breadth
 *      cap (the "giant-dir trap" defense), and a total entry
 *      cap.
 *
 *   2. **Palette toggle.** Registers a shortcut (\u2318\u21e7O by
 *      default) and a matching command-palette action. Both
 *      dispatch the same `togglePalette` event the content
 *      script subscribes to. Mirrors the
 *      `searchRecentWorkspaces` shape.
 *
 *   3. **Palette mount.** Injects the content-script palette
 *      under `./src/content/open-projects-palette.tsx`.
 *
 * Lifecycle: the worker is started inside a `setup()` block so
 * hot-reloads don't accumulate scanners \u2014 each new evaluate
 * tears down the previous worker before forking a new one.
 */
export class OpenProjectsService extends Service.create({
  key: "openProjects",
  deps: {
    db: DbService,
    rpc: RpcService,
    shortcuts: ShortcutsService,
    paletteActions: "paletteActions",
  },
}) {
  /** Currently-running scanner, if any. Kept on the instance so
   * cleanup (`disposeWorker`) can find it. Reset to `null` on
   * `done` / `error` / disposal. */
  private worker: UtilityProcess | null = null

  evaluate() {
    // ----- index walk -------------------------------------------------
    this.setup("scan-on-boot", () => {
      void this.runIndex().catch(() => {})
      return () => this.disposeWorker()
    })

    // ----- palette toggle: shortcut + palette action ------------------
    this.setup("register-shortcut", () =>
      this.ctx.shortcuts.register({
        id: "openProjects.togglePalette",
        name: "Toggle Open Projects Palette",
        category: "Navigation",
        description:
          "Open the project-folder palette \u2014 a fuzzy picker over every project under your home directory.",
        // \u2318O is taken by recent-workspaces; we pair with
        // \u2318\u21e7O so the two are kin without conflicting.
        defaultBinding: IS_MAC
          ? { meta: true, shift: true, key: "o" }
          : { control: true, shift: true, key: "o" },
        handler: () => {
          this.emitToggle("shortcut")
        },
      }),
    )

    this.setup("register-palette-action", () => {
      const reg = this.ctx.paletteActions as {
        register: (spec: unknown) => Promise<unknown>
        unregister: (a: { id: string }) => Promise<unknown>
      }
      const id = "openProjects.togglePalette"
      void reg.register({
        id,
        label: "Open Project\u2026",
        hint: IS_MAC ? "\u2318\u21e7O" : "Ctrl+Shift+O",
        group: "Navigation",
        rpc: {
          plugin: "openProjects",
          service: "openProjects",
          method: "togglePalette",
        },
      })
      return () => {
        void reg.unregister({ id })
      }
    })

    // ----- palette content script -------------------------------------
    this.setup("inject-palette", () =>
      this.inject({
        name: "openProjects/palette",
        modulePath: "./src/content/open-projects-palette.tsx",
      }),
    )
  }

  /**
   * Forwarded to the same event the shortcut emits so both surfaces
   * hit one renderer code path. Called by:
   *
   *   - the command palette ("Open Project\u2026"),
   *   - the tutorial widget,
   *   - any future plugin that wants to drive the picker.
   */
  async togglePalette(_args: { windowId: string }): Promise<{ ok: true }> {
    this.emitToggle("palette")
    return { ok: true }
  }

  /**
   * Manually re-run the walk. Exposed as RPC so a future "Re-index
   * projects" palette action can wire it without restarting the
   * app. Idempotent against an in-flight scan: we kill the
   * existing worker, rotate the collection ref, and start fresh.
   */
  async reindex(_args: Record<string, unknown>): Promise<{ ok: true }> {
    await this.runIndex()
    return { ok: true }
  }

  // ---- internals -----------------------------------------------

  private emitToggle(source: string) {
    this.ctx.rpc.emit.openProjects.togglePalette({ source })
  }

  /**
   * Rotate the index collection, fork the scanner utility
   * process, and stream batches into the collection until the
   * worker posts `done` (or `error`).
   *
   * We rotate the `collectionId` on every walk so progress lands
   * in a fresh underlying collection \u2014 same trick the host
   * file-tree indexer uses to avoid rewriting big arrays into
   * `root.json` on every chunk. The previous collection's data
   * becomes unreferenced and is gc'd by the db layer.
   */
  private async runIndex(): Promise<void> {
    this.disposeWorker()

    const newCollectionId = nanoid()
    await this.ctx.db.client.update(root => {
      root.openProjects.index.projects = makeCollection({
        collectionId: newCollectionId,
        debugName: "open-projects",
      })
      root.openProjects.index.status = "indexing"
      root.openProjects.index.count = 0
      root.openProjects.index.truncated = false
      root.openProjects.index.error = null
    })

    // The worker file is staged at
    //   plugins/open-projects/src/main/workers/scan-projects.mjs
    // and `import.meta.url` here is the service's path under
    //   plugins/open-projects/src/main/services/open-projects.ts
    // so a single `../workers/...` hop resolves in both dev and
    // production (the stager preserves directory shape).
    const here = path.dirname(fileURLToPath(import.meta.url))
    const workerPath = path.resolve(here, "../workers/scan-projects.mjs")

    let child: UtilityProcess
    try {
      child = utilityProcess.fork(workerPath, [], {
        serviceName: "open-projects-scanner",
        stdio: "ignore",
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await this.ctx.db.client.update(root => {
        if (root.openProjects.index.projects.collectionId !== newCollectionId) return
        root.openProjects.index.status = "error"
        root.openProjects.index.error = `fork failed: ${message}`
      })
      return
    }
    this.worker = child

    child.on("message", msg => {
      void this.handleWorkerMessage(msg as ScanMessage, newCollectionId)
    })
    child.on("exit", code => {
      // Treat unexpected non-zero exits as a failure to index, but
      // only when we still believe we're indexing (i.e. the worker
      // crashed mid-flight, not after a clean `done` flipped us to
      // idle). Clean exits with code 0 are no-ops here \u2014
      // `done` already took care of state.
      if (code === 0 || code == null) return
      void this.ctx.db.client.update(root => {
        if (root.openProjects.index.projects.collectionId !== newCollectionId) {
          // Someone else already rotated the collection; we're
          // an old scanner exiting late. Don't trample.
          return
        }
        if (root.openProjects.index.status !== "indexing") return
        root.openProjects.index.status = "error"
        root.openProjects.index.error = `scanner exited with code ${code}`
      })
    })

    child.postMessage({
      type: "start",
      root: os.homedir(),
      // Tunables documented in the worker; keeping them inline
      // here so it's clear which knobs the parent is in charge
      // of vs which live in the worker's defaults.
      options: {
        depthCap: 4,
        breadthCap: 500,
        totalCap: 5000,
      },
    })
  }

  /**
   * Per-message handler split off so the `child.on("message")`
   * listener stays small. The `expectedCollectionId` guards
   * against a stale message from a prior worker arriving after
   * we've rotated the collection \u2014 we just drop those
   * batches on the floor rather than mixing them into the new
   * collection.
   */
  private async handleWorkerMessage(
    msg: ScanMessage,
    expectedCollectionId: string,
  ): Promise<void> {
    if (!msg || typeof msg !== "object") return

    if (msg.type === "batch") {
      // Stale-collection guard. If we kicked off a fresh re-index
      // between the worker building this batch and it landing
      // here, the batch belongs to the previous walk and we
      // should NOT append it.
      const current =
        this.ctx.db.client.readRoot().openProjects.index.projects.collectionId
      if (current !== expectedCollectionId) return
      try {
        await this.ctx.db.client.openProjects.index.projects.concat(msg.entries)
      } catch {
        return
      }
      await this.ctx.db.client.update(root => {
        if (root.openProjects.index.projects.collectionId !== expectedCollectionId) {
          return
        }
        root.openProjects.index.count += msg.entries.length
      })
      return
    }

    if (msg.type === "done") {
      await this.ctx.db.client.update(root => {
        if (root.openProjects.index.projects.collectionId !== expectedCollectionId) {
          return
        }
        root.openProjects.index.status = "idle"
        root.openProjects.index.indexedAt = Date.now()
        root.openProjects.index.truncated = msg.truncated
      })
      this.disposeWorker()
      return
    }

    if (msg.type === "error") {
      await this.ctx.db.client.update(root => {
        if (root.openProjects.index.projects.collectionId !== expectedCollectionId) {
          return
        }
        root.openProjects.index.status = "error"
        root.openProjects.index.error = msg.message
      })
      this.disposeWorker()
      return
    }
  }

  private disposeWorker(): void {
    const w = this.worker
    if (!w) return
    this.worker = null
    try {
      w.kill()
    } catch {
      // Already dead; ignore.
    }
  }
}
