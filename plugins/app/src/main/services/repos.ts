import crypto from "node:crypto"
import fs from "node:fs"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { execFile } from "node:child_process"
import { Service } from "@zenbujs/core/runtime"
import { DbService, RpcService } from "@zenbujs/core/services"
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

/**
 * Heuristic for "the `git` binary is not installed". Node's
 * `execFile` raises `ENOENT` when the program itself can't be
 * spawned (distinct from a non-zero exit, which would surface as
 * an `Error` with `stderr`/`code`). We also match against the
 * message text as a fallback for runtimes that don't propagate the
 * structured `code` field.
 */
function isGitMissing(err: unknown): boolean {
  if (!err || typeof err !== "object") return false
  const e = err as { code?: unknown; errno?: unknown; message?: unknown }
  if (e.code === "ENOENT") return true
  if (typeof e.message === "string" && /ENOENT/.test(e.message)) return true
  return false
}

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
  deps: { db: DbService, rpc: RpcService },
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

  /**
   * Creates a fresh empty directory at `relativePath` (resolved against
   * `$HOME` if it starts with `~` or is otherwise relative) and returns
   * the absolute path. Used by the onboarding screen's "New project"
   * flow. We intentionally don't `git init` — the user can do that
   * later. The workspace machinery handles non-git directories fine.
   */
  async createEmptyProject(args: {
    relativePath: string
  }): Promise<
    | { ok: true; directory: string }
    | { ok: false; error: string }
  > {
    const raw = args.relativePath?.trim()
    if (!raw) return { ok: false, error: "Enter a project path" }

    const home = os.homedir()
    // Normalise leading `~` (with or without separator) to $HOME.
    let resolved: string
    if (raw === "~" || raw.startsWith("~/")) {
      resolved = path.join(home, raw.slice(1).replace(/^\/+/, ""))
    } else if (path.isAbsolute(raw)) {
      resolved = raw
    } else {
      resolved = path.join(home, raw)
    }
    resolved = path.normalize(resolved)

    const name = path.basename(resolved)
    if (!name || name === "." || name === "/") {
      return { ok: false, error: "Project name is required" }
    }
    // Guard against shell-unfriendly names. Allow letters / digits /
    // dashes / dots / underscores / spaces.
    if (!/^[A-Za-z0-9._\- ]+$/.test(name)) {
      return {
        ok: false,
        error: "Project name can only contain letters, numbers, spaces, '.', '_', '-'",
      }
    }

    if (fs.existsSync(resolved)) {
      return { ok: false, error: `Folder already exists: ${resolved}` }
    }

    try {
      await fsp.mkdir(resolved, { recursive: true })
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err ?? "mkdir failed")
      return { ok: false, error: message }
    }

    return { ok: true, directory: resolved }
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

  /** Whether the `git` binary is on PATH. */
  async isGitInstalled(): Promise<boolean> {
    try {
      await execFileP("git", ["--version"])
      return true
    } catch (err) {
      // Ambiguous (non-ENOENT) failures are treated as "present".
      return !isGitMissing(err)
    }
  }

  /**
   * Initialize a fresh git repo at `directory`, lay down an
   * initial commit so `HEAD` resolves (worktrees require a
   * reachable commit), then `detectAndSync` and link the repo id
   * onto every scope already pointing at `directory`.
   *
   * Called by the agent sidebar when the user picks "Create
   * Worktree" on a workspace whose anchor folder isn't yet a git
   * repo. The flow is intentionally silent — the user asked for
   * a worktree, they get one, and the bookkeeping (init + first
   * commit) happens transparently.
   *
   * Idempotent: if `directory` is already inside a git repo, we
   * short-circuit through `detectAndSync` and just make sure the
   * matching scopes have `repoId` filled in.
   */
  async initRepoAtDirectory(args: {
    directory: string
    /** When false, skip staging so existing files stay untracked
     * (the initial commit is empty, just to establish HEAD).
     * Defaults to true. */
    stageInitialFiles?: boolean
  }): Promise<
    | { ok: true; repoId: string }
    | { ok: false; error: string }
  > {
    const stageInitialFiles = args.stageInitialFiles ?? true
    const directory = args.directory?.trim()
    if (!directory || !path.isAbsolute(directory)) {
      return { ok: false, error: "absolute directory required" }
    }
    if (!fs.existsSync(directory)) {
      return { ok: false, error: `directory does not exist: ${directory}` }
    }

    // Short-circuit if `directory` is already in a git repo.
    let commonDir = await this.resolveCommonDir(directory)
    if (!commonDir) {
      try {
        await execFileP("git", ["-C", directory, "init"])
      } catch (err) {
        // ENOENT — the `git` binary is not on PATH. Surface a
        // user-visible toast so the user understands why nothing
        // happened, instead of swallowing the failure into the
        // console.
        if (isGitMissing(err)) {
          this.ctx.rpc.emit.app.notify({
            tone: "error",
            title: "Git is not installed",
            description:
              "Install git and make sure it's on your PATH, then try again.",
          })
          return { ok: false, error: "git is not installed" }
        }
        const message =
          err instanceof Error ? err.message : String(err ?? "git init failed")
        return { ok: false, error: message }
      }

      // Stage anything currently in the directory and lay down a
      // first commit. `--allow-empty` covers the freshly-created
      // project case (no files yet); worktree creation needs a
      // reachable HEAD either way.
      if (stageInitialFiles) {
        try {
          await execFileP("git", ["-C", directory, "add", "-A"])
        } catch {
          // Best-effort — a missing `.gitignore` etc. shouldn't
          // block the initial commit.
        }
      }
      const identityArgs = await this.fallbackIdentityArgs(directory)
      try {
        await execFileP("git", [
          "-C",
          directory,
          ...identityArgs,
          "commit",
          "--allow-empty",
          "-m",
          "Initial commit",
        ])
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : String(err ?? "git commit failed")
        return { ok: false, error: message }
      }

      commonDir = await this.resolveCommonDir(directory)
      if (!commonDir) {
        return { ok: false, error: "git init completed but commonDir not resolvable" }
      }
    }

    const repoId = computeRepoId(commonDir)
    await this.syncRepoToDb(repoId, commonDir)
    await this.startWatcher(repoId, commonDir)

    // Backfill `repoId` on any scope that already pointed at this
    // directory but pre-dates the git init. Without this, the
    // sidebar's `useActiveRepo()` selector (which finds the
    // workspace's repo via `scope.repoId`) keeps returning null.
    await this.ctx.db.client.update(root => {
      for (const scope of Object.values(root.app.scopes)) {
        if (scope.directory === directory && scope.repoId == null) {
          scope.repoId = repoId
        }
      }
    })

    return { ok: true, repoId }
  }

  /**
   * Build `-c user.name=... -c user.email=...` overrides for
   * `git commit`, but only for whichever of the two isn't already
   * configured (global or local). Lets the initial commit succeed
   * on machines where the user has never set up a git identity
   * without trampling an existing one.
   */
  private async fallbackIdentityArgs(directory: string): Promise<string[]> {
    const args: string[] = []
    const probe = async (key: string) => {
      try {
        const { stdout } = await execFileP("git", [
          "-C",
          directory,
          "config",
          "--get",
          key,
        ])
        return stdout.trim().length > 0
      } catch {
        return false
      }
    }
    if (!(await probe("user.name"))) {
      args.push("-c", "user.name=Zenbu")
    }
    if (!(await probe("user.email"))) {
      args.push("-c", "user.email=zenbu@localhost")
    }
    return args
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

  /**
   * Removes a worktree from disk.
   *
   * If the scope is backed by a git repo, runs
   * `git worktree remove --force <path>` against the repo's probe
   * directory (which both unregisters the worktree and deletes
   * its directory). Falls back to an `fs.rm` if git refuses (e.g.
   * the directory was already deleted out from under git, leaving
   * only an admin entry).
   *
   * Refuses to remove the repo's main worktree — that path is the
   * probe we use for every other git operation and nuking it would
   * leave the workspace pointing at a void.
   *
   * Callers (the "Archive worktree" dialog) are expected to have
   * already archived the scope record; this RPC only touches the
   * filesystem + git admin state and triggers a repo resync.
   */
  async removeWorktree(args: {
    scopeId: string
  }): Promise<{ ok: boolean; error?: string }> {
    const root = this.ctx.db.client.readRoot()
    const scope = root.app.scopes[args.scopeId]
    if (!scope) {
      return { ok: false, error: `unknown scope ${args.scopeId}` }
    }
    const directory = scope.directory
    if (!directory) return { ok: false, error: "scope has no directory" }

    if (scope.repoId) {
      const repo = root.app.repos[scope.repoId]
      if (repo) {
        if (directory === repo.mainWorktreePath) {
          return { ok: false, error: "cannot delete the main worktree" }
        }
        const probeDir =
          repo.mainWorktreePath ||
          (await pickProbeDirectory(repo.commonDir))
        if (!probeDir) return { ok: false, error: "no probe directory" }
        let gitError: unknown = null
        try {
          await execFileP("git", [
            "-C",
            probeDir,
            "worktree",
            "remove",
            "--force",
            directory,
          ])
        } catch (err) {
          gitError = err
        }
        if (gitError) {
          // git might refuse if the directory is already gone or
          // unregistered. Best-effort: prune admin state and rm.
          try {
            await execFileP("git", [
              "-C",
              probeDir,
              "worktree",
              "prune",
            ])
          } catch (err) {
            console.warn("[repos] git worktree prune fallback failed:", err)
          }
          try {
            await fsp.rm(directory, { recursive: true, force: true })
          } catch (rmErr) {
            const message =
              rmErr instanceof Error ? rmErr.message : String(rmErr)
            const gitMessage =
              gitError instanceof Error
                ? gitError.message
                : String(gitError ?? "git worktree remove failed")
            return {
              ok: false,
              error: `${gitMessage}; rm fallback failed: ${message}`,
            }
          }
        }
        await this.syncRepoToDb(scope.repoId, repo.commonDir)
        return { ok: true }
      }
    }

    // Non-git scope: just rm the directory.
    try {
      await fsp.rm(directory, { recursive: true, force: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: message }
    }
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
      } catch (err) {
        console.warn("[repos] watcher close failed for", w.repoId, err)
      }
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
  } catch (err) {
    console.warn("[repos] failed to resolve main worktree for", commonDir, err)
  }
  return path.dirname(commonDir)
}

async function listWorktrees(probeDir: string): Promise<Repo["worktrees"][number][]> {
  try {
    const { stdout } = await execFileP(
      "git",
      ["-C", probeDir, "worktree", "list", "--porcelain"],
    )
    return parseWorktreePorcelain(stdout)
  } catch (err) {
    console.warn("[repos] failed to list worktrees for", probeDir, err)
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
