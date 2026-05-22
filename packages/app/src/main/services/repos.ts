import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { promisify } from "node:util"
import { execFile } from "node:child_process"
import { Service } from "@zenbujs/core/runtime"
import { DbService } from "@zenbujs/core/services"
import type { Schema } from "../schema"

type Repo = Schema["repos"][string]
type Worktree = Repo["worktrees"][number]
type Branch = Repo["branches"][number]

const execFileP = promisify(execFile)

type Watcher = {
  repoId: string
  commonDir: string
  watchers: fs.FSWatcher[]
  debounce: NodeJS.Timeout | null
}

const WATCH_DEBOUNCE_MS = 250

function deriveRepoNameFromUrl(url: string): string | null {
  // Handle scp-like syntax: git@github.com:owner/repo.git
  let tail = url
  const scpMatch = url.match(/^[^/]+@[^:]+:(.+)$/)
  if (scpMatch) {
    tail = scpMatch[1]
  } else {
    try {
      const u = new URL(url)
      tail = u.pathname
    } catch {
      tail = url
    }
  }
  const segments = tail.split(/[\\/]/).filter(Boolean)
  let last = segments.pop() ?? ""
  if (last.endsWith(".git")) last = last.slice(0, -4)
  last = last.trim()
  return last || null
}

export class ReposService extends Service.create({
  key: "repos",
  deps: { db: DbService },
}) {
  private readonly watchers = new Map<string, Watcher>()

  async evaluate() {
    const repos = this.ctx.db.client.readRoot().app.repos
    for (const repo of Object.values(repos)) {
      void this.startWatcher(repo.id, repo.commonDir).catch(err =>
        console.warn("[repos] failed to start watcher for", repo.id, err),
      )
      void this.syncRepo(repo.commonDir).catch(err =>
        console.warn("[repos] initial resync failed for", repo.id, err),
      )
    }

    this.setup("dispose-watchers", () => () => {
      for (const w of this.watchers.values()) this.tearDownWatcher(w)
      this.watchers.clear()
    })
  }

  async cloneFromUrl(args: {
    url: string
    parentDir: string
  }): Promise<
    | { ok: true; directory: string }
    | { ok: false; error: string }
  > {
    const url = args.url.trim()
    if (!url) return { ok: false, error: "URL is required" }
    const parentDir = args.parentDir
    if (!parentDir || !path.isAbsolute(parentDir)) {
      return { ok: false, error: "A target folder is required" }
    }
    if (!fs.existsSync(parentDir)) {
      return { ok: false, error: `Target folder does not exist: ${parentDir}` }
    }
    const repoName = deriveRepoNameFromUrl(url)
    if (!repoName) {
      return { ok: false, error: "Could not derive a folder name from URL" }
    }
    const directory = path.join(parentDir, repoName)
    if (fs.existsSync(directory)) {
      return { ok: false, error: `Folder already exists: ${directory}` }
    }
    try {
      await execFileP("git", ["clone", url, directory])
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err ?? "git clone failed")
      return { ok: false, error: message }
    }
    return { ok: true, directory }
  }

  async detectAndSync(args: {
    directory: string
  }): Promise<{ repoId: string | null }> {
    const commonDir = await this.resolveCommonDir(args.directory)
    if (!commonDir) return { repoId: null }
    const repoId = computeRepoId(commonDir)
    await this.syncRepoToDb(repoId, commonDir)
    await this.startWatcher(repoId, commonDir)
    return { repoId }
  }

  async createWorktree(args: {
    repoId: string
    worktreePath: string
    branch: string
    /** Source ref (branch name, sha, etc.) to base the new branch on. */
    sourceRef?: string
    /** When true, runs `git worktree add -b <branch> <path> [<sourceRef>]`. */
    createBranch: boolean
  }): Promise<{ ok: boolean; error?: string }> {
    const repo = this.ctx.db.client.readRoot().app.repos[args.repoId]
    if (!repo) {
      return { ok: false, error: `unknown repo ${args.repoId}` }
    }
    const probeDir = repo.mainWorktreePath || (await pickProbeDirectory(repo.commonDir))
    if (!probeDir) {
      return { ok: false, error: "no probe directory" }
    }
    const gitArgs: string[] = ["worktree", "add"]
    if (args.createBranch) {
      gitArgs.push("-b", args.branch, args.worktreePath)
      if (args.sourceRef) gitArgs.push(args.sourceRef)
    } else {
      gitArgs.push(args.worktreePath, args.branch)
    }
    try {
      await execFileP("git", ["-C", probeDir, ...gitArgs])
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err ?? "git failed")
      return { ok: false, error: message }
    }
    await this.syncRepoToDb(args.repoId, repo.commonDir)
    return { ok: true }
  }

  private async resolveCommonDir(directory: string): Promise<string | null> {
    try {
      const { stdout } = await execFileP(
        "git",
        ["-C", directory, "rev-parse", "--git-common-dir"],
      )
      const raw = stdout.trim()
      if (!raw) return null
      const abs = path.isAbsolute(raw) ? raw : path.resolve(directory, raw)
      return fs.existsSync(abs) ? path.resolve(abs) : null
    } catch {
      return null
    }
  }

  private async syncRepo(commonDir: string): Promise<void> {
    const repoId = computeRepoId(commonDir)
    await this.syncRepoToDb(repoId, commonDir)
  }

  private async syncRepoToDb(
    repoId: string,
    commonDir: string,
  ): Promise<void> {
    const probeDir = await pickProbeDirectory(commonDir)
    if (!probeDir) return
    const [worktrees, branches, mainWorktreePath] = await Promise.all([
      listWorktrees(probeDir),
      listBranches(probeDir),
      resolveMainWorktree(probeDir, commonDir),
    ])
    const record: Repo = {
      id: repoId,
      commonDir,
      mainWorktreePath,
      worktrees,
      branches,
      syncedAt: Date.now(),
    }
    await this.ctx.db.client.update(root => {
      root.app.repos[repoId] = record
    })
  }

  private async startWatcher(repoId: string, commonDir: string): Promise<void> {
    if (this.watchers.has(repoId)) return
    const targets = [
      path.join(commonDir, "HEAD"),
      path.join(commonDir, "refs"),
      path.join(commonDir, "worktrees"),
      path.join(commonDir, "packed-refs"),
    ]
    const watcher: Watcher = {
      repoId,
      commonDir,
      watchers: [],
      debounce: null,
    }
    for (const target of targets) {
      if (!fs.existsSync(target)) continue
      try {
        const w = fs.watch(target, { recursive: true }, () => {
          this.scheduleResync(watcher)
        })
        w.on("error", err =>
          console.warn("[repos] watcher error for", target, err),
        )
        watcher.watchers.push(w)
      } catch (err) {
        console.warn("[repos] failed to watch", target, err)
      }
    }
    this.watchers.set(repoId, watcher)
  }

  private scheduleResync(w: Watcher) {
    if (w.debounce) clearTimeout(w.debounce)
    w.debounce = setTimeout(() => {
      w.debounce = null
      void this.syncRepo(w.commonDir).catch(err =>
        console.warn("[repos] debounced resync failed:", err),
      )
    }, WATCH_DEBOUNCE_MS)
  }

  private tearDownWatcher(w: Watcher) {
    if (w.debounce) clearTimeout(w.debounce)
    for (const watcher of w.watchers) {
      try {
        watcher.close()
      } catch {}
    }
  }
}

function computeRepoId(commonDir: string): string {
  return crypto
    .createHash("sha1")
    .update(path.resolve(commonDir))
    .digest("hex")
    .slice(0, 16)
}

async function pickProbeDirectory(commonDir: string): Promise<string | null> {
  const parent = path.dirname(commonDir)
  if (fs.existsSync(parent)) return parent
  return null
}

async function resolveMainWorktree(
  probeDir: string,
  commonDir: string,
): Promise<string> {
  try {
    const { stdout } = await execFileP(
      "git",
      ["-C", probeDir, "rev-parse", "--path-format=absolute", "--show-toplevel"],
    )
    const candidate = stdout.trim()
    if (candidate) return candidate
  } catch {}
  return path.dirname(commonDir)
}

async function listWorktrees(probeDir: string): Promise<Repo["worktrees"][number][]> {
  try {
    const { stdout } = await execFileP(
      "git",
      ["-C", probeDir, "worktree", "list", "--porcelain"],
    )
    return parseWorktreePorcelain(stdout)
  } catch {
    return []
  }
}

function parseWorktreePorcelain(text: string): Repo["worktrees"][number][] {
  const out: Repo["worktrees"][number][] = []
  let current: Partial<Repo["worktrees"][number]> & { detached?: boolean } = {}
  const flush = () => {
    if (!current.path) return
    out.push({
      path: current.path,
      branch: current.branch ?? null,
      headSha: current.headSha ?? "",
      isPrimary: out.length === 0,
      locked: current.locked ?? false,
      prunable: current.prunable ?? false,
    })
    current = {}
  }
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trimEnd()
    if (line === "") {
      flush()
      continue
    }
    if (line.startsWith("worktree ")) {
      current.path = line.slice("worktree ".length)
    } else if (line.startsWith("HEAD ")) {
      current.headSha = line.slice("HEAD ".length)
    } else if (line.startsWith("branch ")) {
      const ref = line.slice("branch ".length)
      current.branch = ref.replace(/^refs\/heads\//, "")
    } else if (line === "detached") {
      current.detached = true
      current.branch = null
    } else if (line === "locked" || line.startsWith("locked ")) {
      current.locked = true
    } else if (line === "prunable" || line.startsWith("prunable ")) {
      current.prunable = true
    } else if (line === "bare") {
      current.detached = true
    }
  }
  flush()
  return out
}

async function listBranches(probeDir: string): Promise<Repo["branches"][number][]> {
  try {
    const { stdout } = await execFileP("git", [
      "-C",
      probeDir,
      "for-each-ref",
      "refs/heads",
      "--format=%(refname:short)%00%(upstream:short)%00%(objectname)%00%(committerdate:unix)",
    ])
    const out: Repo["branches"][number][] = []
    for (const rawLine of stdout.split("\n")) {
      const line = rawLine.trimEnd()
      if (!line) continue
      const [name, upstream, headSha, unixStr] = line.split("\x00")
      const unix = Number(unixStr)
      out.push({
        name,
        upstream: upstream || null,
        headSha: headSha ?? "",
        lastCommitAt: Number.isFinite(unix) ? unix * 1000 : 0,
      })
    }
    out.sort((a, b) => b.lastCommitAt - a.lastCommitAt)
    return out
  } catch {
    return []
  }
}
