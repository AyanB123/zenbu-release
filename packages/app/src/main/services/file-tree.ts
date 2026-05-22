import path from "node:path"
import fs from "node:fs/promises"
import { watch, type FSWatcher } from "node:fs"
import { Service } from "@zenbujs/core/runtime"
import {
  DbService,
  RendererHostService,
  RpcService,
  ViewRegistryService,
} from "@zenbujs/core/services"

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  ".cache",
  ".zenbu",
  "dist",
  "build",
  "out",
  "target",
  ".venv",
  "venv",
  "__pycache__",
  ".DS_Store",
])

const MAX_PATHS = 20_000
const MAX_FILE_BYTES = 2 * 1024 * 1024
/** How many paths to accumulate between intermediate DB publishes during a
 * full walk. Tuned so that the menu paints within ~50ms on a cold start
 * for typical repos. */
const WALK_PUBLISH_CHUNK = 500
/** Debounce for FS-watcher-triggered re-indexes. Bursty saves (e.g. `pnpm
 * install`) collapse into a single walk. */
const WATCH_DEBOUNCE_MS = 250

/**
 * Registers three views and maintains a per-scope file index in
 * `root.app.fileTreeIndexes`:
 *
 *  - `"file-tree"`         — pane view: tree + preview in a split. Plain
 *                              `kind: "view"`, no sidebar flag.
 *  - `"file-tree-sidebar"` — sidebar view: just the tree. Clicking a
 *                              file calls `openFile({...})` which emits
 *                              an `openFileInActivePane` event the main
 *                              shell catches to add a new pane tab.
 *  - `"file"`              — pane view tagged `kind: "embed"`: read-only
 *                              file viewer that takes `{ directory, path }`
 *                              as args. The `embed` kind keeps it out of
 *                              the command palette (it needs args to be
 *                              meaningful) while still letting other
 *                              services open it via `useOpenView`.
 *
 * All three are vite-aliased over the renderer's server so they share
 * tailwind / theme vars. The views read file-tree state straight from
 * the DB so first render is synchronous.
 */
export class FileTreeService extends Service.create({
  key: "fileTree",
  deps: {
    viewRegistry: ViewRegistryService,
    db: DbService,
    // Needed so we can emit `openFileInActivePane` when the sidebar
    // view asks to open a file.
    rpc: RpcService,
    // Order-only: registerAlias("app", …) needs the renderer's vite
    // server to already be live.
    rendererHost: RendererHostService,
  },
}) {
  /** Scope ids we have an in-flight indexing job for. Prevents re-entrancy
   * if `scopes` fires twice in quick succession. */
  private indexing = new Set<string>()
  /** Active FS watchers keyed by scopeId. */
  private watchers = new Map<string, { watcher: FSWatcher; directory: string }>()
  /** Debounce timers for watcher-triggered re-indexes. */
  private watchTimers = new Map<string, NodeJS.Timeout>()

  evaluate() {
    this.setup("register-view", () => {
      this.ctx.viewRegistry.registerAlias({
        type: "file-tree",
        reloaderId: "app",
        pathPrefix: "/views/file-tree",
        meta: { kind: "view", label: "Files" },
      })
      return () => {
        void this.ctx.viewRegistry.unregister("file-tree")
      }
    })

    this.setup("register-sidebar-view", () => {
      this.ctx.viewRegistry.registerAlias({
        type: "file-tree-sidebar",
        reloaderId: "app",
        pathPrefix: "/views/file-tree-sidebar",
        meta: { kind: "view", sidebar: true, label: "Files" },
      })
      return () => {
        void this.ctx.viewRegistry.unregister("file-tree-sidebar")
      }
    })

    this.setup("register-file-view", () => {
      this.ctx.viewRegistry.registerAlias({
        type: "file",
        reloaderId: "app",
        pathPrefix: "/views/file",
        // `kind: "embed"` excludes the view from the command palette
        // (it needs args to be useful) while still letting other
        // services / event handlers open it via `useOpenView`.
        meta: { kind: "embed", label: "File" },
      })
      return () => {
        void this.ctx.viewRegistry.unregister("file")
      }
    })

    this.setup("index-scopes", () => {
      this.reconcileIndexes()
      const unsub = this.ctx.db.client.app.scopes.subscribe(() => {
        this.reconcileIndexes()
      })
      return () => {
        unsub()
        for (const t of this.watchTimers.values()) clearTimeout(t)
        this.watchTimers.clear()
        for (const { watcher } of this.watchers.values()) watcher.close()
        this.watchers.clear()
      }
    })
  }

  /** Called by the file-tree sidebar view when the user clicks a file.
   * Re-broadcasts as an `openFileInActivePane` event so the main shell
   * (which owns the pane layout) can add a tab in the active pane. We
   * intentionally don't reach into pane state from here — the service
   * doesn't know which window is active. */
  async openFile(args: {
    directory: string
    path: string
  }): Promise<{ ok: true }> {
    this.ctx.rpc.emit.app.openFileInActivePane({
      directory: args.directory,
      path: args.path,
    })
    return { ok: true }
  }

  /** Re-index a scope on demand. Useful when the renderer wants a fresh
   * view of disk after a known mutation outside of FS watcher coverage. */
  async reindex(args: { scopeId: string }): Promise<{ ok: true }> {
    const scope = this.ctx.db.client.readRoot().app.scopes[args.scopeId]
    if (!scope) throw new Error(`unknown scope: ${args.scopeId}`)
    await this.indexScope(scope.id, scope.directory)
    return { ok: true }
  }

  async readFile(args: {
    directory: string
    path: string
  }): Promise<{ content: string; truncated: boolean; binary: boolean }> {
    const abs = safeJoin(args.directory, args.path)
    const stat = await fs.stat(abs)
    if (!stat.isFile()) throw new Error(`not a file: ${args.path}`)
    const buf = await fs.readFile(abs)
    if (looksBinary(buf)) {
      return { content: "", truncated: false, binary: true }
    }
    if (buf.byteLength > MAX_FILE_BYTES) {
      return {
        content: buf.subarray(0, MAX_FILE_BYTES).toString("utf8"),
        truncated: true,
        binary: false,
      }
    }
    return { content: buf.toString("utf8"), truncated: false, binary: false }
  }

  async writeFile(args: {
    directory: string
    path: string
    content: string
  }): Promise<{ ok: true }> {
    const abs = safeJoin(args.directory, args.path)
    await fs.writeFile(abs, args.content, "utf8")
    return { ok: true }
  }

  /** For each scope: ensure an index exists, and a watcher is running on
   * its directory. For each index/watcher whose scope is gone or whose
   * directory has changed: drop / re-index / re-watch. */
  private reconcileIndexes(): void {
    const root = this.ctx.db.client.readRoot()
    const scopes = root.app.scopes
    const indexes = root.app.fileTreeIndexes

    for (const scope of Object.values(scopes)) {
      const existing = indexes[scope.id]
      const existingWatcher = this.watchers.get(scope.id)
      const dirChanged = existingWatcher?.directory !== scope.directory
      if (dirChanged) {
        existingWatcher?.watcher.close()
        this.watchers.delete(scope.id)
        this.startWatcher(scope.id, scope.directory)
      }
      if (existing && existing.directory === scope.directory) continue
      void this.indexScope(scope.id, scope.directory)
    }

    const liveIds = new Set(Object.keys(scopes))
    const orphaned = Object.keys(indexes).filter(id => !liveIds.has(id))
    if (orphaned.length > 0) {
      void this.ctx.db.client.update(r => {
        for (const id of orphaned) delete r.app.fileTreeIndexes[id]
      })
    }
    for (const id of Array.from(this.watchers.keys())) {
      if (liveIds.has(id)) continue
      this.watchers.get(id)?.watcher.close()
      this.watchers.delete(id)
      const t = this.watchTimers.get(id)
      if (t) clearTimeout(t)
      this.watchTimers.delete(id)
    }
  }

  /** Start a recursive FS watcher on `directory`. Bursty events collapse
   * into a single debounced re-index. We use Node's built-in `fs.watch`
   * with `recursive: true` — supported on macOS and Windows natively,
   * and on Linux from Node 20 onward (which Electron 28+ bundles). */
  private startWatcher(scopeId: string, directory: string): void {
    let watcher: FSWatcher
    try {
      watcher = watch(
        directory,
        { recursive: true, persistent: false },
        (_event, filename) => {
          // Skip events inside ignored dirs cheaply — the walker will
          // filter them too, but this saves us scheduling work.
          if (typeof filename === "string") {
            const top = filename.split(/[\\/]/, 1)[0]
            if (top && IGNORE_DIRS.has(top)) return
          }
          this.scheduleReindex(scopeId, directory)
        },
      )
    } catch (err) {
      console.warn(
        `[fileTree] failed to start watcher for ${directory}:`,
        err instanceof Error ? err.message : err,
      )
      return
    }
    watcher.on("error", err => {
      console.warn(`[fileTree] watcher error for ${directory}:`, err.message)
    })
    this.watchers.set(scopeId, { watcher, directory })
  }

  private scheduleReindex(scopeId: string, directory: string): void {
    const existing = this.watchTimers.get(scopeId)
    if (existing) clearTimeout(existing)
    const t = setTimeout(() => {
      this.watchTimers.delete(scopeId)
      // Re-check the scope still points at this directory before walking.
      const scope = this.ctx.db.client.readRoot().app.scopes[scopeId]
      if (!scope || scope.directory !== directory) return
      void this.indexScope(scopeId, directory)
    }, WATCH_DEBOUNCE_MS)
    this.watchTimers.set(scopeId, t)
  }

  private async indexScope(scopeId: string, directory: string): Promise<void> {
    if (this.indexing.has(scopeId)) return
    this.indexing.add(scopeId)
    try {
      await this.ctx.db.client.update(root => {
        const prev = root.app.fileTreeIndexes[scopeId]
        root.app.fileTreeIndexes[scopeId] = {
          scopeId,
          directory,
          // Keep the old paths in place while re-indexing so the menu
          // stays usable. They'll be replaced atomically at the end.
          paths: prev?.directory === directory ? prev.paths : [],
          status: "indexing",
          error: null,
          indexedAt: prev?.indexedAt ?? 0,
          truncated: false,
        }
      })

      const paths: string[] = []
      // Publish in chunks so the @ menu can render before the full walk
      // completes. The first chunk lands within a few ms for most repos.
      let lastPublish = 0
      const publishProgress = async () => {
        if (paths.length - lastPublish < WALK_PUBLISH_CHUNK) return
        lastPublish = paths.length
        const snapshot = paths.slice().sort()
        await this.ctx.db.client.update(root => {
          const cur = root.app.fileTreeIndexes[scopeId]
          if (!cur || cur.directory !== directory) return
          cur.paths = snapshot
        })
      }
      await walk(directory, "", paths, publishProgress)
      paths.sort()
      const truncated = paths.length >= MAX_PATHS

      await this.ctx.db.client.update(root => {
        root.app.fileTreeIndexes[scopeId] = {
          scopeId,
          directory,
          paths,
          status: "idle",
          error: null,
          indexedAt: Date.now(),
          truncated,
        }
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await this.ctx.db.client.update(root => {
        const prev = root.app.fileTreeIndexes[scopeId]
        root.app.fileTreeIndexes[scopeId] = {
          scopeId,
          directory,
          paths: prev?.paths ?? [],
          status: "error",
          error: message,
          indexedAt: prev?.indexedAt ?? 0,
          truncated: prev?.truncated ?? false,
        }
      })
    } finally {
      this.indexing.delete(scopeId)
    }
  }
}

async function walk(
  root: string,
  rel: string,
  out: string[],
  onProgress?: () => Promise<void>,
): Promise<void> {
  if (out.length >= MAX_PATHS) return
  let entries: import("node:fs").Dirent[]
  try {
    entries = await fs.readdir(path.join(root, rel), { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (out.length >= MAX_PATHS) return
    if (IGNORE_DIRS.has(entry.name)) continue
    const childRel = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      await walk(root, childRel, out, onProgress)
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      out.push(childRel)
      if (onProgress) await onProgress()
    }
  }
}

/** Resolve `rel` against `root`, refusing any path that escapes root via
 * `..` or absolute segments. */
function safeJoin(root: string, rel: string): string {
  const normalizedRoot = path.resolve(root)
  const abs = path.resolve(normalizedRoot, rel)
  if (abs !== normalizedRoot && !abs.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error(`path escapes root: ${rel}`)
  }
  return abs
}

/** Cheap NUL-byte heuristic. Good enough to keep CodeMirror from being
 * handed obviously-binary blobs. */
function looksBinary(buf: Buffer): boolean {
  const limit = Math.min(buf.byteLength, 8192)
  for (let i = 0; i < limit; i++) {
    if (buf[i] === 0) return true
  }
  return false
}
