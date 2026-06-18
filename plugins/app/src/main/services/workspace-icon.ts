import path from "node:path"
import fs from "node:fs/promises"
import type { Dirent } from "node:fs"
import { Service } from "@zenbujs/core/runtime"
import { DbService } from "@zenbujs/core/services"
import { IGNORE_DIRS } from "../lib/ignore-dirs"

/**
 * Owns the "find an icon for this workspace by scanning its
 * directory" flow.
 *
 * Inspired by OpenCode's `Project.discover` (which globs the
 * worktree for `favicon.{ico,png,svg,jpg,jpeg,webp}` and inlines
 * the shortest-path match as a data URL on the project row). We
 * borrow the *shape* of the idea — find a file by convention,
 * inline the bytes, cache forever — but replace the unbounded
 * `**\/favicon.*` glob with a bounded, ignore-aware BFS so a
 * `node_modules`-heavy monorepo can't blow up workspace-create
 * latency.
 *
 * The result is stored on `workspace.iconAuto` (a blob ref +
 * mime), independently from the user-uploaded `workspace.icon`.
 * See the schema for the rationale on having two fields rather
 * than a discriminator.
 *
 * Discovery is idempotent: once `iconAutoAttempted` flips to true,
 * we never re-walk unless `rediscover()` is called explicitly.
 * Errors (read failures, broken symlinks, permission denied) are
 * swallowed — the UI just falls back to the letter tile.
 */

// --- discovery budget -------------------------------------------------------

/** Max BFS depth from the workspace root. Tuned so the common
 *  monorepo layouts (`public/`, `apps/<x>/public/`,
 *  `packages/<x>/public/`) are still reachable without descending
 *  into rabbit holes. */
const MAX_DEPTH = 5
/** Hard cap on directories visited during a single discover scan.
 *  At ~typical web-project density this comfortably covers
 *  whole repos; pathological monorepos hit the cap and we give up
 *  rather than chew through 10k directories looking for a
 *  favicon. */
const MAX_DIRS_VISITED = 400
/** Skip any directory containing more than this many entries.
 *  Generated output (e.g. `build/` artifacts the user didn't
 *  bother to .gitignore, big `assets/` dumps, vendored data)
 *  isn't where the project icon lives, and walking them dwarfs
 *  the rest of the scan. */
const MAX_ENTRIES_PER_DIR = 500
/** Wall-clock cap. Discovery runs forked off workspace creation
 *  and runs again at boot for backfill, but neither path should
 *  ever stall the UI behind a long scan. */
const TIME_BUDGET_MS = 250
/** Reject candidate files larger than this. We're inlining the
 *  bytes into a blob (and therefore into every replica sync), so
 *  a 4MB marketing PNG would be silly. Real favicons are < 50KB;
 *  512KB is a generous ceiling. */
const MAX_FILE_BYTES = 512 * 1024

// --- filename scoring -------------------------------------------------------

/** Stem priority: purpose-built `favicon.*` beats `logo.*` beats
 *  the generic `icon.*`. Higher is better. */
const STEM_SCORES: Record<string, number> = {
  favicon: 100,
  logo: 60,
  icon: 40,
}

/** Extension priority: SVG renders crisply at any size and is
 *  usually the smallest, PNG is the safe rendered choice, `.ico`
 *  works but is often multi-resolution + larger, lossy formats
 *  last. Higher is better. */
const EXT_SCORES: Record<string, number> = {
  ".svg": 50,
  ".png": 40,
  ".ico": 30,
  ".webp": 25,
  ".jpg": 10,
  ".jpeg": 10,
}

const MIME_BY_EXT: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
}

/**
 * Score a filename as an icon candidate, returning a positive
 * number on match and 0 on reject. Depth is folded in as a small
 * penalty so a shallower match still beats a deeper one with the
 * same stem/ext.
 */
function scoreCandidate(filename: string, depth: number): number {
  const ext = path.extname(filename).toLowerCase()
  const stem = filename.slice(0, filename.length - ext.length).toLowerCase()
  const stemScore = STEM_SCORES[stem]
  const extScore = EXT_SCORES[ext]
  if (!stemScore || !extScore) return 0
  // Depth penalty: each level deep costs 1 point. At max depth 5
  // this is at most a 5-point swing, which doesn't override stem
  // or extension preference — a shallow `logo.jpg` still loses to
  // a deeper `favicon.svg`, but a shallow `favicon.png` beats a
  // deeper `favicon.png`.
  return stemScore + extScore - depth
}

/** Priority paths checked before the BFS. Hits here let us
 *  short-circuit with a single `stat` per candidate, which is
 *  where ~all real-world projects resolve. */
const PRIORITY_RELATIVE_PATHS = [
  // repo root
  "favicon.svg",
  "favicon.png",
  "favicon.ico",
  // public/ (CRA, Vite default, etc.)
  "public/favicon.svg",
  "public/favicon.png",
  "public/favicon.ico",
  // static/ (SvelteKit, some Next.js layouts)
  "static/favicon.svg",
  "static/favicon.png",
  "static/favicon.ico",
  // app/ (Next.js app router puts favicon.ico here)
  "app/favicon.svg",
  "app/favicon.png",
  "app/favicon.ico",
  // src/ (some Vite templates)
  "src/favicon.svg",
  "src/favicon.png",
  "src/favicon.ico",
  // assets/
  "assets/favicon.svg",
  "assets/favicon.png",
] as const

// --- types ------------------------------------------------------------------

type Candidate = {
  /** Absolute path on disk. */
  absPath: string
  /** Path relative to the workspace root, stored for debugging. */
  relPath: string
  /** Higher is better. */
  score: number
}

// --- service ----------------------------------------------------------------

export class WorkspaceIconService extends Service.create({
  key: "workspaceIcon",
  deps: { db: DbService },
}) {
  /**
   * Boot-time backfill. Sweep any workspaces that exist today but
   * haven't yet had their icon-discovery pass — i.e. they were
   * created before this service shipped, or a previous run
   * crashed before flipping `iconAutoAttempted`.
   *
   * Runs serially with no concurrency cap; each individual
   * `discover` call has its own time budget so the total cost is
   * bounded by (#workspaces × TIME_BUDGET_MS). Even a user with
   * 50 workspaces is < 15s wall-clock, all of it off the main
   * thread / behind the UI. We deliberately do *not* await this
   * inside `evaluate` — fire-and-forget so the rest of boot
   * isn't blocked.
   */
  async evaluate() {
    void this.backfill().catch(err => {
      console.error("[workspace-icon] backfill failed:", err)
    })
  }

  private async backfill(): Promise<void> {
    const root = this.ctx.db.client.readRoot()
    const targets: Array<{ workspaceId: string; directory: string }> = []
    for (const ws of Object.values(root.app.workspaces)) {
      if (ws.iconAutoAttempted) continue
      if (ws.archived) continue
      // Need a scope to know which directory to scan. Use the
      // first non-archived scope's directory — for typical
      // workspaces this is the only scope; for multi-scope
      // workspaces any one is a fine source of an icon since the
      // user picked them all as siblings on the same repo.
      const scope = Object.values(root.app.scopes).find(
        s => s.workspaceId === ws.id && !s.archived,
      )
      if (!scope) continue
      targets.push({ workspaceId: ws.id, directory: scope.directory })
    }
    for (const target of targets) {
      try {
        await this.discover(target)
      } catch (err) {
        console.error(
          `[workspace-icon] backfill discover failed for ${target.workspaceId}:`,
          err,
        )
      }
    }
  }

  /**
   * Attempt to derive an icon for `workspaceId` by scanning
   * `directory`. Idempotent: short-circuits if discovery has
   * already been attempted for this workspace. Always flips
   * `iconAutoAttempted` to true on completion, even on a miss,
   * so future boots don't re-walk.
   *
   * Safe to fire-and-forget. Errors are caught internally and
   * logged; the only externally observable failure mode is "no
   * icon got written, so the UI falls back to the letter tile."
   */
  async discover(args: {
    workspaceId: string
    directory: string
  }): Promise<void> {
    const { workspaceId, directory } = args
    const ws = this.ctx.db.client.readRoot().app.workspaces[workspaceId]
    if (!ws) return
    if (ws.iconAutoAttempted) return

    // Mark attempted up front so any concurrent re-entry (e.g.
    // backfill racing with a fresh `createFromDirectory` call
    // for the same workspace) bails on the second caller. The
    // worst case is a missed discovery if the *first* call
    // crashes before writing the icon — we accept that vs. the
    // alternative (duplicate scans, duplicate blobs).
    await this.ctx.db.client.update(root => {
      const w = root.app.workspaces[workspaceId]
      if (!w) return
      w.iconAutoAttempted = true
    })

    const deadline = Date.now() + TIME_BUDGET_MS
    const found =
      (await this.checkPriorityPaths(directory, deadline)) ??
      (await this.bfsForCandidate(directory, deadline))
    if (!found) return

    let bytes: Buffer
    try {
      const stat = await fs.stat(found.absPath)
      if (stat.size > MAX_FILE_BYTES) return
      bytes = await fs.readFile(found.absPath)
    } catch {
      return
    }

    const mimeType =
      MIME_BY_EXT[path.extname(found.absPath).toLowerCase()] ??
      "application/octet-stream"

    const blobId = await this.ctx.db.client.createBlob(
      new Uint8Array(bytes),
      true,
    )

    await this.ctx.db.client.update(root => {
      const w = root.app.workspaces[workspaceId]
      if (!w) return
      // If something already wrote an iconAuto while we were
      // reading (unlikely but possible with backfill + fresh
      // create racing), drop our blob and keep theirs. The other
      // one's bytes are equally good and we'd just be leaking.
      if (w.iconAuto) {
        void this.ctx.db.client.deleteBlob(blobId).catch(err =>
          console.warn("[workspace-icon] unreferenced icon blob cleanup failed:", err),
        )
        return
      }
      w.iconAuto = {
        blobId,
        mimeType,
        sourcePath: found.relPath,
        discoveredAt: Date.now(),
      }
    })
  }

  /**
   * Force a re-scan: clears any existing `iconAuto` (deleting its
   * blob) and flips `iconAutoAttempted` back to false, then runs
   * a fresh discovery. Exposed for future UI ("re-detect icon"
   * menu item) — not called from any boot path.
   */
  async rediscover(args: {
    workspaceId: string
    directory: string
  }): Promise<void> {
    const prev =
      this.ctx.db.client.readRoot().app.workspaces[args.workspaceId]
        ?.iconAuto ?? null
    await this.ctx.db.client.update(root => {
      const w = root.app.workspaces[args.workspaceId]
      if (!w) return
      w.iconAuto = null
      w.iconAutoAttempted = false
    })
    if (prev?.blobId) {
      try {
        await this.ctx.db.client.deleteBlob(prev.blobId)
      } catch (err) {
        console.error("[workspace-icon] deleteBlob failed:", err)
      }
    }
    await this.discover(args)
  }

  // --- internals ------------------------------------------------------------

  private async checkPriorityPaths(
    root: string,
    deadline: number,
  ): Promise<Candidate | null> {
    let best: Candidate | null = null
    for (const rel of PRIORITY_RELATIVE_PATHS) {
      if (Date.now() > deadline) break
      const absPath = path.join(root, rel)
      let stat: import("node:fs").Stats
      try {
        stat = await fs.stat(absPath)
      } catch {
        continue
      }
      if (!stat.isFile()) continue
      // Reuse the same scoring function so the priority-path
      // ordering doesn't have to be "perfect" — if e.g.
      // `app/favicon.ico` and `public/favicon.svg` both exist,
      // scoring picks the SVG even though `app/` is listed
      // higher in the priority array.
      const depth = rel.split("/").length - 1
      const score = scoreCandidate(path.basename(rel), depth)
      if (!score) continue
      if (!best || score > best.score) {
        best = { absPath, relPath: rel, score }
      }
    }
    return best
  }

  private async bfsForCandidate(
    root: string,
    deadline: number,
  ): Promise<Candidate | null> {
    const queue: Array<{ dir: string; depth: number; rel: string }> = [
      { dir: root, depth: 0, rel: "" },
    ]
    let visited = 0
    let best: Candidate | null = null

    while (queue.length > 0) {
      if (Date.now() > deadline) break
      if (visited >= MAX_DIRS_VISITED) break
      const { dir, depth, rel } = queue.shift()!
      visited++

      let entries: Dirent[]
      try {
        entries = await fs.readdir(dir, { withFileTypes: true })
      } catch {
        continue
      }
      // Skip pathologically wide directories. The file we want
      // is never going to live in a folder with 500+ entries —
      // those are generated output, vendored data dumps, big
      // asset libraries. Cheap signal, big savings.
      if (entries.length > MAX_ENTRIES_PER_DIR) continue

      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (IGNORE_DIRS.has(entry.name)) continue
          // Skip every dotdir we don't explicitly whitelist.
          // Icons don't live in `.github/`, `.cursor/`, etc., and
          // most are noise. Real candidates live in
          // `public/`, `static/`, `assets/`, `src/`, `app/`, all
          // non-dot.
          if (entry.name.startsWith(".")) continue
          if (depth + 1 > MAX_DEPTH) continue
          const childRel = rel ? `${rel}/${entry.name}` : entry.name
          queue.push({
            dir: path.join(dir, entry.name),
            depth: depth + 1,
            rel: childRel,
          })
        } else if (entry.isFile()) {
          const score = scoreCandidate(entry.name, depth)
          if (score <= 0) continue
          if (!best || score > best.score) {
            best = {
              absPath: path.join(dir, entry.name),
              relPath: rel ? `${rel}/${entry.name}` : entry.name,
              score,
            }
          }
        }
      }
    }

    return best
  }
}
