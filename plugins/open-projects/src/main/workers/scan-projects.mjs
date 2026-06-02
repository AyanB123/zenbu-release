// @ts-check
/**
 * Open-projects scanner. Runs in an Electron utility process
 * (spawned by `OpenProjectsService` via `utilityProcess.fork`).
 *
 * Why a utility process: walking `$HOME` synchronously on the main
 * process pegs it for hundreds of milliseconds on the cold path
 * (every IPC tick blocks while we readdir), and on a warm `~/code`
 * the recursive readdir can briefly burn 100% of a core. The
 * utility process gives us an isolated Node runtime that can grind
 * without affecting Electron's main loop or any renderer; we just
 * postMessage batches back as we find them.
 *
 * Plain Node ESM on purpose: `utilityProcess.fork` runs the script
 * in a vanilla Node environment with no Vite / tsx loader in the
 * loop, so this file can't be `.ts`. We document the message
 * protocol in this header so the parent service can stay typed
 * against it.
 *
 * ────────────────────────────────────────────────────────────────
 * Message protocol
 * ────────────────────────────────────────────────────────────────
 *
 * Parent → Child:
 *   { type: "start", root: string, options: {
 *       depthCap: number,
 *       breadthCap: number,
 *       totalCap: number,
 *     } }
 *   { type: "abort" }   // reserved; not used in v1
 *
 * Child → Parent:
 *   { type: "batch", entries: Array<{
 *       path: string, name: string, parent: string,
 *       depth: number, marker: string,
 *     }> }
 *   { type: "done", count: number, truncated: boolean }
 *   { type: "error", message: string }
 */

import fs from "node:fs/promises"
import path from "node:path"

/**
 * Directory basenames we never descend into. Mirror of the host's
 * `IGNORE_DIRS` set (`plugins/app/src/main/lib/ignore-dirs.ts`).
 * Duplicated inline instead of imported because the worker runs
 * outside the plugin loader and shouldn't reach across plugin
 * boundaries at runtime. The list is small + stable; if it drifts,
 * it just costs a few extra walked dirs, not correctness.
 */
const IGNORE_DIRS = new Set([
  // VCS
  ".git",
  ".hg",
  ".svn",
  // Package managers / vendored deps
  "node_modules",
  "bower_components",
  "vendor",
  // Build / framework output
  "dist",
  "build",
  "out",
  "target",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".output",
  ".vercel",
  ".expo",
  "storybook-static",
  // Tool caches
  ".turbo",
  ".cache",
  ".parcel-cache",
  ".gradle",
  // Test / coverage
  "coverage",
  ".pytest_cache",
  // Python
  ".venv",
  "venv",
  "__pycache__",
  // Editor / OS junk
  ".idea",
  ".vscode",
  ".DS_Store",
  // Zenbu's own generated stuff
  ".zenbu",
  // OS-managed directories at the user-profile level. These
  // aren't in the host's `IGNORE_DIRS` (it never walks them —
  // its scopes are inside individual projects, never `$HOME`).
  // Adding them here is a precaution against the
  // `~/Library/Application Support/<thousands of hashed dirs>`
  // trap on macOS and the equivalent Windows %APPDATA%
  // backed paths. The breadth-cap below would catch the deeper
  // sub-folders, but skipping the parent saves a few thousand
  // readdir round-trips on cold start.
  "Library", // macOS
  "Applications", // macOS - .app bundles, not project folders
  "AppData", // Windows
  // macOS TCC-protected user folders. Reading these triggers a
  // privacy prompt ("Zenbu would like to access files in your
  // Documents/Downloads/Desktop folder"). We never want to surface
  // those prompts during a background index, so skip the folders
  // entirely. Projects living under them won't be indexed, which is
  // the intended trade-off.
  "Documents", // macOS - TCC prompt
  "Downloads", // macOS - TCC prompt
  "Desktop", // macOS - TCC prompt
  "Movies", // macOS - TCC prompt (Photos/media)
  "Music", // macOS - TCC prompt
  "Pictures", // macOS - TCC prompt
  "Public", // macOS shared folder
])

/**
 * Filenames whose presence in a directory marks it as a "project
 * root". When we see any of these we record the parent directory
 * and STOP descending — we don't want to surface every workspace
 * inside a monorepo as its own row, just the monorepo itself.
 *
 * Ordered roughly by signal strength so the first hit wins. `.git`
 * is the strongest signal; `Makefile` is the weakest (lots of
 * non-project dirs have one) but it's the only marker for a
 * meaningful slice of C / OCaml / etc. projects.
 */
const PROJECT_MARKERS = [
  ".git",
  "package.json",
  "Cargo.toml",
  "pyproject.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "Gemfile",
  "deno.json",
  "zenbu.config.ts",
  "Makefile",
]

/** Tunable defaults; the parent overrides via the start message. */
const DEFAULTS = {
  depthCap: 4,
  breadthCap: 500,
  totalCap: 5000,
}

/** Flush a batch every N entries OR every M ms, whichever fires first.
 * Keeps the palette feeling alive on a cold index while not spamming
 * the IPC channel with single-entry messages. */
const BATCH_SIZE = 50
const BATCH_INTERVAL_MS = 80

/**
 * Whichever side of the IPC fence we're on, the message bus is
 * `process.parentPort`. Bail loudly if it's missing — that means
 * someone tried to run this script directly (e.g. via `node
 * scan-projects.mjs`) and the parent-side code paths won't work
 * anyway.
 */
console.info("[open-projects/scanner] booted, pid=", process.pid)
const parent = /** @type {any} */ (process).parentPort
if (!parent) {
  console.error("[open-projects/scanner] no parentPort; not running under utilityProcess")
  process.exit(1)
}

// `parentPort` is a `MessagePortMain`; messages arrive as
// MessageEvent-like objects with a `.data` field. Using `.on`
// auto-starts the port; we don't need an explicit `.start()`.
parent.on("message", (event) => {
  const msg = event && typeof event === "object" ? event.data : event
  console.info("[open-projects/scanner] received message type=", msg?.type)
  if (!msg || typeof msg !== "object") return
  if (msg.type === "start") {
    void run(msg)
  }
  // "abort" is reserved but we have no long-running cancellable
  // state to honor today; if we add re-indexing on demand we'll
  // wire it here.
})

/**
 * Entry point. Walks the requested root, batches entries to the
 * parent, then posts `done` (or `error`). Single-shot: we exit
 * the process implicitly when the event loop empties, which
 * Electron treats as a clean utility-process exit.
 */
async function run(msg) {
  const root = typeof msg.root === "string" ? msg.root : ""
  if (!root) {
    parent.postMessage({ type: "error", message: "missing root path" })
    return
  }
  const opts = { ...DEFAULTS, ...(msg.options ?? {}) }

  /** Buffered entries waiting to be flushed. */
  let pending = []
  /** Total entries recorded so far. */
  let total = 0
  /** Wall-clock of last flush; used to coalesce frequent finds. */
  let lastFlush = Date.now()

  const flush = () => {
    if (pending.length === 0) return
    parent.postMessage({ type: "batch", entries: pending })
    pending = []
    lastFlush = Date.now()
  }
  const record = (entry) => {
    pending.push(entry)
    total++
    const now = Date.now()
    if (
      pending.length >= BATCH_SIZE ||
      now - lastFlush >= BATCH_INTERVAL_MS
    ) {
      flush()
    }
  }

  try {
    console.info(
      "[open-projects/scanner] walking root=",
      root,
      "opts=",
      opts,
    )
    await walk({
      absPath: root,
      depth: 0,
      opts,
      record,
      isTruncated: () => total >= opts.totalCap,
    })
    flush()
    console.info(
      "[open-projects/scanner] done; total=",
      total,
      "truncated=",
      total >= opts.totalCap,
    )
    parent.postMessage({
      type: "done",
      count: total,
      truncated: total >= opts.totalCap,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    parent.postMessage({ type: "error", message })
  }
}

/**
 * Recursive DFS. Pure async/await; we eat the cost of one promise
 * per dir for clarity (no manual worker pool) — the parent process
 * doesn't care, and FS is the bottleneck anyway.
 *
 * Walks `absPath` at the given `depth`. The decision tree per
 * entry:
 *
 *   1. If we've hit `totalCap`, stop entirely.
 *   2. `readdir(absPath, { withFileTypes: true })`.
 *   3. If the dir has more than `breadthCap` entries, skip it
 *      whole-cloth. That's the "giant-dir trap" defense — a 50k-
 *      entry directory is almost always `~/Library`, `~/Downloads`,
 *      or some media cache, and crawling it for project markers
 *      costs orders of magnitude more than it'd ever return.
 *   4. Scan once to detect a project marker AT THIS LEVEL. If we
 *      find one, record the current dir and STOP descending.
 *   5. Otherwise, for each subdir:
 *      - skip if basename starts with "." (catches `.git`,
 *        `.zenbu`, `.config`, etc.),
 *      - skip if basename is in IGNORE_DIRS,
 *      - skip if we'd exceed depth cap,
 *      - else recurse depth+1.
 */
async function walk({ absPath, depth, opts, record, isTruncated }) {
  if (isTruncated()) return

  /** @type {import("node:fs").Dirent[]} */
  let entries
  try {
    entries = await fs.readdir(absPath, { withFileTypes: true })
  } catch (err) {
    // EACCES / ENOENT / etc. — silently skip.
    if (depth <= 1) {
      console.warn(
        "[open-projects/scanner] readdir failed",
        { absPath, depth, message: String(err) },
      )
    }
    return
  }
  if (depth <= 1) {
    console.info(
      "[open-projects/scanner] readdir",
      { absPath, depth, entries: entries.length },
    )
  }

  // Giant-dir trap defense. Count only entries we'd actually
  // descend into (real directories, not dotdirs, not in the
  // ignore set, not random files).
  //
  // The root (`depth === 0`) is intentionally exempt: it's the
  // user's `$HOME` and "too many subdirs" is normal there (501
  // on the maintainer's machine, almost all of them legitimate
  // candidates). The cap is meant to catch deep traps like
  // `~/Library/Application Support/<thousands of hashed dirs>`,
  // not the home directory itself. Walking 600 top-level dirs
  // is still cheap because each one immediately stops at its
  // own marker.
  if (depth > 0) {
    let recurseCount = 0
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const n = entry.name
      if (n.startsWith(".")) continue
      if (IGNORE_DIRS.has(n)) continue
      recurseCount++
      if (recurseCount > opts.breadthCap) break
    }
    if (depth <= 1) {
      console.info(
        "[open-projects/scanner] recurseCount",
        { absPath, depth, recurseCount },
      )
    }
    if (recurseCount > opts.breadthCap) return
  }

  // Phase 1: marker detection at this level. We only need a
  // *yes/no* answer here, so we scan filenames cheaply and bail
  // on the first hit.
  let markerHit = null
  if (depth > 0) {
    // Only treat `absPath` itself as a project candidate when we're
    // below the root. The root (`$HOME`) is never a project even
    // if the user weirdly has a `package.json` there.
    for (const entry of entries) {
      if (PROJECT_MARKERS.includes(entry.name)) {
        markerHit = entry.name
        break
      }
    }
  }

  if (markerHit) {
    if (depth <= 2) {
      console.info(
        "[open-projects/scanner] marker hit",
        { absPath, depth, marker: markerHit },
      )
    }
    record({
      path: absPath,
      name: path.basename(absPath),
      parent: path.dirname(absPath),
      depth,
      marker: markerHit,
    })
    // STOP descending. The marker found *here* gives this folder
    // its identity; subdirs of a project aren't separately
    // openable projects in their own right.
    return
  }

  if (depth >= opts.depthCap) return

  // Phase 2: recurse into eligible subdirs.
  for (const entry of entries) {
    if (isTruncated()) return
    if (!entry.isDirectory()) continue
    const name = entry.name
    if (name.startsWith(".")) continue
    if (IGNORE_DIRS.has(name)) continue
    await walk({
      absPath: path.join(absPath, name),
      depth: depth + 1,
      opts,
      record,
      isTruncated,
    })
  }
}
