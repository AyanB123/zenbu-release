import crypto from "node:crypto"
import fsp from "node:fs/promises"
import type { Stats } from "node:fs"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { execFile } from "node:child_process"
import { Service } from "@zenbujs/core/runtime"
import { DbService } from "@zenbujs/core/services"
import type { Schema } from "../schema"

type RecentProject = Schema["recentProjects"][string]
type Source = RecentProject["sources"][number]

const execFileP = promisify(execFile)
const SQLITE_TIMEOUT_MS = 1500

/**
 * VS Code-derived IDEs we know how to scrape. Each entry is the
 * folder name under `~/Library/Application Support/`. Adding a new
 * fork is just appending here — the data layout is identical
 * across all of them (key `history.recentlyOpenedPathsList` in
 * `state.vscdb`; per-workspace dirs under `workspaceStorage`).
 */
const IDE_APPS: ReadonlyArray<{ source: Source; appName: string }> = [
  { source: "code", appName: "Code" },
  { source: "cursor", appName: "Cursor" },
  { source: "windsurf", appName: "Windsurf" },
  { source: "antigravity", appName: "Antigravity" },
  { source: "trae", appName: "Trae" },
]

/** Cap on how many entries we persist. The renderer only shows the
 * top N anyway, and the on-disk list can grow to ~700 entries per
 * IDE, so we trim aggressively. */
const MAX_ENTRIES = 50

export class RecentProjectsService extends Service.create({
  key: "recentProjects",
  deps: { db: DbService },
}) {
  evaluate() {
    // Run once on boot, fire-and-forget. The sqlite3 fan-out across
    // installed IDEs takes 400-800ms; the onboarding screen renders
    // an empty Recent list and reactively populates from the DB
    // update once this resolves, so there's no user-visible benefit
    // to gating boot on it.
    void this.refresh().catch(err =>
      console.warn("[recent-projects] initial refresh failed:", err),
    )
  }

  /** Re-scan every installed IDE and overwrite the
   * `recentProjects` record in the DB. Exposed via RPC so the
   * renderer can trigger a refresh (e.g. after the user creates a
   * new workspace from somewhere else and wants the list to
   * update). */
  async refresh(): Promise<{ count: number }> {
    const merged = await collectAcrossIdes()
    const trimmed = merged.slice(0, MAX_ENTRIES)
    const next: Record<string, RecentProject> = {}
    for (const entry of trimmed) {
      next[entry.id] = entry
    }
    await this.ctx.db.client.update(root => {
      // Full replacement rather than diff/patch: the source data
      // (other IDEs' state) is authoritative, and stale entries
      // (folder deleted, IDE uninstalled) should disappear
      // without us having to track their previous state.
      root.app.recentProjects = next
    })
    return { count: trimmed.length }
  }
}

/* ---------- internals ---------- */

async function collectAcrossIdes(): Promise<RecentProject[]> {
  const supportDir = path.join(
    os.homedir(),
    "Library",
    "Application Support",
  )
  // Per-path aggregation: { path -> { sources, lastOpenedAt } }.
  const byPath = new Map<
    string,
    { name: string; lastOpenedAt: number; sources: Set<Source> }
  >()
  for (const { source, appName } of IDE_APPS) {
    const appDir = path.join(supportDir, appName)
    if (!(await pathExists(appDir))) continue
    try {
      const entries = await collectFromIde(appDir)
      for (const { path: folderPath, lastOpenedAt } of entries) {
        const prev = byPath.get(folderPath)
        if (prev) {
          prev.lastOpenedAt = Math.max(prev.lastOpenedAt, lastOpenedAt)
          prev.sources.add(source)
        } else {
          byPath.set(folderPath, {
            name: path.basename(folderPath) || folderPath,
            lastOpenedAt,
            sources: new Set([source]),
          })
        }
      }
    } catch (err) {
      console.warn(
        `[recent-projects] failed to read ${appName}:`,
        err instanceof Error ? err.message : err,
      )
    }
  }
  const out: RecentProject[] = []
  for (const [folderPath, info] of byPath) {
    out.push({
      id: hashPath(folderPath),
      path: folderPath,
      name: info.name,
      lastOpenedAt: info.lastOpenedAt,
      sources: Array.from(info.sources).sort(),
    })
  }
  out.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
  return out
}

async function collectFromIde(
  appDir: string,
): Promise<Array<{ path: string; lastOpenedAt: number }>> {
  const userDir = path.join(appDir, "User")
  const dbPath = path.join(userDir, "globalStorage", "state.vscdb")
  if (!(await pathExists(dbPath))) return []

  const orderedPaths = await readRecentList(dbPath)
  if (orderedPaths.length === 0) return []

  const mtimes = await readWorkspaceMtimes(
    path.join(userDir, "workspaceStorage"),
  )

  // Fall back to a synthetic timestamp derived from the entry's
  // position in the recent list when we don't have a real mtime,
  // so entries without a workspaceStorage match still sort
  // sensibly *within their own IDE*. The base is "now" so they
  // rank below anything with a real mtime from any IDE without
  // colliding with each other.
  const now = Date.now()
  const out: Array<{ path: string; lastOpenedAt: number }> = []
  for (let i = 0; i < orderedPaths.length; i++) {
    const folderPath = orderedPaths[i]!
    const stat = await safeStat(folderPath)
    // Skip files masquerading as folders (shouldn't happen since
    // we filter by `folderUri`, but defensive).
    if (!stat?.isDirectory()) continue
    const real = mtimes.get(folderPath)
    const lastOpenedAt = real ?? now - i * 1000
    out.push({ path: folderPath, lastOpenedAt })
  }
  return out
}

/** Read the `history.recentlyOpenedPathsList` JSON out of the IDE's
 * SQLite DB. We shell out to `sqlite3 -readonly` so we don't have
 * to bundle a native bindings package — macOS ships with sqlite3,
 * and read-only mode means we won't conflict with a live IDE
 * holding a write lock.
 *
 * Returns local filesystem paths in original (most-recent-first)
 * order, with non-`file:` and non-folder entries dropped. */
async function readRecentList(dbPath: string): Promise<string[]> {
  let raw: string
  try {
    // `-readonly` opens the DB read-only so we coexist with a
    // running IDE. `-cmd ".timeout 1000"` would help if the IDE
    // were write-locking aggressively, but in practice the global
    // state DB isn't a hot path so a plain read works.
    const { stdout } = await execFileP("sqlite3", [
      "-readonly",
      dbPath,
      "SELECT value FROM ItemTable WHERE key='history.recentlyOpenedPathsList';",
    ], { timeout: SQLITE_TIMEOUT_MS, maxBuffer: 2 * 1024 * 1024 })
    raw = stdout.trim()
  } catch (err) {
    console.warn(
      "[recent-projects] sqlite3 failed for",
      dbPath,
      err instanceof Error ? err.message : err,
    )
    return []
  }
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  const entries = (parsed as { entries?: unknown }).entries
  if (!Array.isArray(entries)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue
    const folderUri = (entry as { folderUri?: unknown }).folderUri
    if (typeof folderUri !== "string") continue
    const local = fileUriToPath(folderUri)
    if (!local) continue
    if (seen.has(local)) continue
    seen.add(local)
    out.push(local)
  }
  return out
}

/** Walk `workspaceStorage/<hash>/workspace.json` once per IDE,
 * building a `path -> mtime` lookup for single-folder workspaces.
 * Multi-root workspaces (the `workspace` field instead of `folder`)
 * are skipped — they don't correspond to a single openable folder
 * and we can't represent them as a one-click action anyway. */
async function readWorkspaceMtimes(
  workspaceStorageDir: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (!(await pathExists(workspaceStorageDir))) return out
  let dirents: import("node:fs").Dirent[]
  try {
    dirents = await fsp.readdir(workspaceStorageDir, { withFileTypes: true })
  } catch (err) {
    console.warn(
      "[recent-projects] failed to read workspaceStorage:",
      err instanceof Error ? err.message : err,
    )
    return out
  }
  const results = await Promise.all(
    dirents.filter(d => d.isDirectory()).map(async d => {
    const subDir = path.join(workspaceStorageDir, d.name)
    const jsonPath = path.join(subDir, "workspace.json")
    let parsed: { folder?: unknown }
    try {
      const [raw, stat] = await Promise.all([
        fsp.readFile(jsonPath, "utf-8"),
        fsp.stat(subDir),
      ])
      parsed = JSON.parse(raw)
      return { parsed, mtimeMs: stat.mtimeMs }
    } catch {
      return null
    }
    }),
  )
  for (const result of results) {
    if (!result) continue
    const { parsed, mtimeMs } = result
    const folder = parsed.folder
    if (typeof folder !== "string") continue
    const local = fileUriToPath(folder)
    if (!local) continue
    const prev = out.get(local)
    if (prev == null || mtimeMs > prev) out.set(local, mtimeMs)
  }
  return out
}

/** Decode a `file://` URI to a local absolute path. Returns null
 * for non-`file:` schemes (e.g. `vscode-vfs://github/...` remote
 * GitHub workspaces, which we deliberately ignore — they aren't
 * openable as a local folder). */
function fileUriToPath(uri: string): string | null {
  if (!uri.startsWith("file://")) return null
  try {
    // `new URL(...)` is the canonical, encoding-aware way; falling
    // back to manual decoding would mishandle paths with spaces or
    // unicode characters.
    const u = new URL(uri)
    if (u.protocol !== "file:") return null
    const decoded = decodeURIComponent(u.pathname)
    return path.normalize(decoded)
  } catch {
    return null
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p)
    return true
  } catch {
    return false
  }
}

async function safeStat(p: string): Promise<Stats | null> {
  try {
    return await fsp.stat(p)
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
      console.warn(
        "[recent-projects] stat failed:",
        p,
        err instanceof Error ? err.message : err,
      )
    }
    return null
  }
}

function hashPath(p: string): string {
  return crypto.createHash("sha1").update(p).digest("hex").slice(0, 16)
}
