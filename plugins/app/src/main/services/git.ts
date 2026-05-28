import { execFile } from "node:child_process"
import { promisify } from "node:util"
import fs from "node:fs/promises"
import path from "node:path"
import { Service } from "@zenbujs/core/runtime"

const execFileP = promisify(execFile)

/**
 * Read a single text file and count line additions. Returns
 * `{ binary: true, additions: 0 }` for files that look binary or
 * are too large to bother with.
 */
async function countTextAdditions(
  full: string,
  size: number,
): Promise<{ additions: number; binary: boolean }> {
  if (size >= 4 * 1024 * 1024) return { additions: 0, binary: true }
  const content = await fs.readFile(full)
  for (let k = 0; k < Math.min(content.length, 4096); k++) {
    if (content[k] === 0) return { additions: 0, binary: true }
  }
  if (content.length === 0) return { additions: 0, binary: false }
  const text = content.toString("utf8")
  let additions = text.split("\n").length
  if (text.endsWith("\n")) additions -= 1
  if (additions < 0) additions = 0
  return { additions, binary: false }
}

/**
 * Walk an untracked directory and yield one entry per text file
 * inside it (relative path, additions, binary). Skips `node_modules`
 * and `.git`. Caps total files visited so we don't hang the commit
 * popover on a multi-gigabyte tree someone forgot to gitignore.
 */
async function walkDirFiles(
  root: string,
): Promise<Array<{ relPath: string; additions: number; binary: boolean }>> {
  const MAX_FILES = 2000
  const out: Array<{ relPath: string; additions: number; binary: boolean }> = []
  const stack: string[] = [root]
  while (stack.length > 0 && out.length < MAX_FILES) {
    const dir = stack.pop()!
    let entries: import("node:fs").Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const ent of entries) {
      if (out.length >= MAX_FILES) break
      if (ent.name === ".git" || ent.name === "node_modules") continue
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        stack.push(full)
        continue
      }
      if (!ent.isFile()) continue
      try {
        const stat = await fs.stat(full)
        const m = await countTextAdditions(full, stat.size)
        out.push({
          relPath: path.relative(root, full),
          additions: m.additions,
          binary: m.binary,
        })
      } catch {
        // ignore unreadable file
      }
    }
  }
  return out
}

type LastCommit = {
  hash: string
  shortHash: string
  subject: string
  author: string
  relativeDate: string
} | null

type StatusSummary = {
  ok: boolean
  isRepo: boolean
  additions: number
  deletions: number
  changed: number
  untracked: number
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  lastCommit: LastCommit
}

type CommitFile = {
  path: string
  oldPath: string | null
  /** Two-letter porcelain XY code. */
  status: string
  additions: number
  deletions: number
  /** True for unreadable/binary files where line counts aren't meaningful. */
  binary: boolean
}

type CommitPreview = {
  ok: boolean
  isRepo: boolean
  branch: string | null
  files: CommitFile[]
  additions: number
  deletions: number
}

/**
 * Cheap git plumbing for the title-bar commit button:
 *  - `getStatusSummary` is poll-friendly: two short `git` invocations
 *    in parallel, no file IO, returns a single +/- pair plus an
 *    untracked count.
 *  - `getCommitPreview` is only called when the commit modal opens,
 *    so it can afford to read untracked files from disk to compute
 *    line counts for the per-file +/- display.
 *  - `commit` does `git add -A` then `git commit -m`. Cheap and
 *    non-blocking on the main thread (execFile is async).
 *
 * Errors are surfaced as `{ ok: false }` instead of thrown so the
 * renderer doesn't spam its console while a directory is missing
 * or not a git repo yet.
 */
export class GitService extends Service.create({
  key: "git",
}) {
  async getStatusSummary(args: {
    directory: string
  }): Promise<StatusSummary> {
    const directory = args.directory
    if (!directory) {
      return emptyStatus()
    }

    const [numstat, untracked, branch, upstream, aheadBehind, lastLog] =
      await Promise.all([
        runGit(["diff", "--numstat", "HEAD"], directory),
        runGit(
          ["ls-files", "--others", "--exclude-standard"],
          directory,
        ),
        runGit(["rev-parse", "--abbrev-ref", "HEAD"], directory),
        runGit(
          ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
          directory,
        ),
        runGit(
          ["rev-list", "--left-right", "--count", "HEAD...@{u}"],
          directory,
        ),
        runGit(
          [
            "log",
            "-1",
            "--pretty=format:%H%x09%h%x09%an%x09%ar%x09%s",
          ],
          directory,
        ),
      ])

    // If HEAD doesn't exist yet (fresh repo) `git diff HEAD` fails;
    // the catch above returns null which we treat as "no changes".
    if (
      numstat == null &&
      untracked == null &&
      branch == null &&
      lastLog == null
    ) {
      return { ...emptyStatus(), isRepo: false }
    }

    let ahead = 0
    let behind = 0
    if (aheadBehind) {
      const parts = aheadBehind.trim().split(/\s+/)
      if (parts.length === 2) {
        ahead = parseInt(parts[0], 10) || 0
        behind = parseInt(parts[1], 10) || 0
      }
    }

    let lastCommit: LastCommit = null
    if (lastLog && lastLog.trim()) {
      const [hash, shortHash, author, relativeDate, ...rest] = lastLog
        .trim()
        .split("\t")
      lastCommit = {
        hash: hash ?? "",
        shortHash: shortHash ?? "",
        author: author ?? "",
        relativeDate: relativeDate ?? "",
        subject: rest.join("\t"),
      }
    }

    let additions = 0
    let deletions = 0
    let changed = 0
    if (numstat) {
      for (const line of numstat.split("\n")) {
        if (!line) continue
        const parts = line.split("\t")
        if (parts.length < 3) continue
        const a = parts[0]
        const d = parts[1]
        if (a !== "-") additions += parseInt(a, 10) || 0
        if (d !== "-") deletions += parseInt(d, 10) || 0
        changed++
      }
    }
    const untrackedFiles = (untracked ?? "")
      .split("\n")
      .filter(Boolean)

    return {
      ok: true,
      isRepo: true,
      additions,
      deletions,
      changed,
      untracked: untrackedFiles.length,
      branch: (branch ?? "").trim() || null,
      upstream: (upstream ?? "").trim() || null,
      ahead,
      behind,
      lastCommit,
    }
  }

  async fetch(args: {
    directory: string
  }): Promise<{ ok: true } | { ok: false; error: string }> {
    return runRemote(args.directory, ["fetch", "--prune"])
  }

  async pull(args: {
    directory: string
  }): Promise<{ ok: true } | { ok: false; error: string }> {
    return runRemote(args.directory, ["pull", "--ff-only"])
  }

  async push(args: {
    directory: string
  }): Promise<{ ok: true } | { ok: false; error: string }> {
    return runRemote(args.directory, ["push"])
  }

  async getCommitPreview(args: {
    directory: string
  }): Promise<CommitPreview> {
    const directory = args.directory
    if (!directory) {
      return {
        ok: false,
        isRepo: false,
        branch: null,
        files: [],
        additions: 0,
        deletions: 0,
      }
    }

    const [numstat, status, branch] = await Promise.all([
      runGit(["diff", "--numstat", "HEAD"], directory),
      runGit(["status", "--porcelain=v1", "-z"], directory),
      runGit(["rev-parse", "--abbrev-ref", "HEAD"], directory),
    ])
    if (status == null) {
      return {
        ok: false,
        isRepo: false,
        branch: null,
        files: [],
        additions: 0,
        deletions: 0,
      }
    }

    type NumEntry = { additions: number; deletions: number; binary: boolean }
    const numMap = new Map<string, NumEntry>()
    if (numstat) {
      for (const line of numstat.split("\n")) {
        if (!line) continue
        const parts = line.split("\t")
        if (parts.length < 3) continue
        const a = parts[0]
        const d = parts[1]
        const p = parts.slice(2).join("\t")
        const binary = a === "-" || d === "-"
        numMap.set(p, {
          additions: binary ? 0 : parseInt(a, 10) || 0,
          deletions: binary ? 0 : parseInt(d, 10) || 0,
          binary,
        })
      }
    }

    // Parse NUL-separated porcelain v1 output. Renames/copies emit two
    // NUL-separated path fields (new, then old).
    const entries: Array<{
      code: string
      path: string
      oldPath: string | null
    }> = []
    const buf = status
    let i = 0
    while (i < buf.length) {
      if (i + 3 > buf.length) break
      const code = buf.slice(i, i + 2)
      // chars at i+2 is a single space separator
      const nul = buf.indexOf("\0", i + 3)
      if (nul === -1) break
      const newPath = buf.slice(i + 3, nul)
      let oldPath: string | null = null
      let next = nul + 1
      if (code[0] === "R" || code[0] === "C") {
        const oldNul = buf.indexOf("\0", next)
        if (oldNul === -1) break
        oldPath = buf.slice(next, oldNul)
        next = oldNul + 1
      }
      entries.push({ code, path: newPath, oldPath })
      i = next
    }

    let totalAdds = 0
    let totalDels = 0
    const files: CommitFile[] = []
    for (const e of entries) {
      const n = numMap.get(e.path)
      let additions = n?.additions ?? 0
      let deletions = n?.deletions ?? 0
      let binary = n?.binary ?? false
      if (e.code === "??" && !binary) {
        // Untracked: count lines of the file on disk to give the
        // commit modal something meaningful to show. Git emits a
        // single porcelain entry per untracked directory (trailing
        // slash), so we walk those directories and emit one entry
        // per file inside.
        const full = path.isAbsolute(e.path)
          ? e.path
          : path.join(directory, e.path)
        try {
          const stat = await fs.stat(full)
          if (stat.isFile()) {
            const m = await countTextAdditions(full, stat.size)
            additions = m.additions
            binary = m.binary
          } else if (stat.isDirectory()) {
            // Expand the directory: one CommitFile per file inside.
            // Strip any trailing slash from the porcelain path so we
            // can join cleanly.
            const dirRel = e.path.replace(/\/+$/, "")
            const inner = await walkDirFiles(full)
            for (const f of inner) {
              if (!f.binary) totalAdds += f.additions
              files.push({
                path: path.posix.join(dirRel, f.relPath.split(path.sep).join("/")),
                oldPath: null,
                status: "??",
                additions: f.binary ? 0 : f.additions,
                deletions: 0,
                binary: f.binary,
              })
            }
            continue
          } else {
            binary = true
          }
        } catch {
          binary = true
        }
      }
      totalAdds += additions
      totalDels += deletions
      files.push({
        path: e.path,
        oldPath: e.oldPath,
        status: e.code,
        additions,
        deletions,
        binary,
      })
    }

    files.sort((a, b) => a.path.localeCompare(b.path))

    return {
      ok: true,
      isRepo: true,
      branch: (branch ?? "").trim() || null,
      files,
      additions: totalAdds,
      deletions: totalDels,
    }
  }

  async commit(args: {
    directory: string
    message: string
  }): Promise<{ ok: true } | { ok: false; error: string }> {
    const directory = args.directory
    const message = args.message?.trim()
    if (!directory) return { ok: false, error: "No directory" }
    if (!message) return { ok: false, error: "Commit message is required" }
    try {
      await execFileP("git", ["add", "-A"], {
        cwd: directory,
        maxBuffer: 16 * 1024 * 1024,
      })
      await execFileP("git", ["commit", "-m", message], {
        cwd: directory,
        maxBuffer: 16 * 1024 * 1024,
      })
      return { ok: true }
    } catch (err) {
      const e = err as NodeJS.ErrnoException & {
        stdout?: string
        stderr?: string
      }
      const detail =
        (e.stderr && e.stderr.toString().trim()) ||
        (e.stdout && e.stdout.toString().trim()) ||
        e.message ||
        "git commit failed"
      return { ok: false, error: detail }
    }
  }
}

function emptyStatus(): StatusSummary {
  return {
    ok: true,
    isRepo: true,
    additions: 0,
    deletions: 0,
    changed: 0,
    untracked: 0,
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    lastCommit: null,
  }
}

async function runRemote(
  directory: string,
  argv: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!directory) return { ok: false, error: "No directory" }
  try {
    await execFileP("git", argv, {
      cwd: directory,
      maxBuffer: 16 * 1024 * 1024,
    })
    return { ok: true }
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      stdout?: string
      stderr?: string
    }
    const detail =
      (e.stderr && e.stderr.toString().trim()) ||
      (e.stdout && e.stdout.toString().trim()) ||
      e.message ||
      `git ${argv[0]} failed`
    return { ok: false, error: detail }
  }
}

async function runGit(
  argv: string[],
  cwd: string,
): Promise<string | null> {
  try {
    const { stdout } = await execFileP("git", argv, {
      cwd,
      maxBuffer: 16 * 1024 * 1024,
    })
    return stdout
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string }
    // Some commands (like `git diff HEAD` in a fresh repo) exit non-zero
    // even though they printed useful output. Return what they printed
    // so we don't lose info.
    if (e.stdout != null) return e.stdout
    return null
  }
}
