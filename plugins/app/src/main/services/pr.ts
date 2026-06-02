import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { Service } from "@zenbujs/core/runtime"
import {
} from "@zenbujs/core/services"

const execFileP = promisify(execFile)

const MAX_BUFFER = 64 * 1024 * 1024

export type GitFileStatus = {
  /** Working-tree path. */
  path: string
  /** Old path for renames/copies. */
  oldPath: string | null
  /** Porcelain XY code, e.g. " M", "A ", "MM", "??". */
  code: string
  /** Index-side status code. */
  indexStatus: string
  /** Worktree-side status code. */
  workStatus: string
  staged: boolean
  unstaged: boolean
  untracked: boolean
  /** Line-count deltas for tracked files (unstaged side). */
  additions: number
  deletions: number
  binary: boolean
}

export type GitStatus = {
  ok: boolean
  isRepo: boolean
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  detached: boolean
  files: GitFileStatus[]
}

export type GitCommit = {
  sha: string
  shortSha: string
  subject: string
  body: string
  authorName: string
  authorEmail: string
  authorDate: number
  parents: string[]
  refs: string
}

export type GitBranch = {
  name: string
  shortName: string
  remote: boolean
  isCurrent: boolean
  upstream: string | null
  headSha: string
  lastCommitAt: number
  subject: string
}

/**
 * Mini git client backing the "Git" view. Wraps a focused set of git
 * plumbing/porcelain commands and exposes them as RPC so the renderer
 * can drive a GitHub Desktop-style UI:
 *
 *   - status / diffs for the changes tab
 *   - history + per-commit diffs for the history tab
 *   - branch list + checkout/create for the branch picker
 *   - stage/unstage/discard, commit (with amend), fetch/pull/push
 *
 * Errors are surfaced as `{ ok: false, error }` rather than thrown so
 * the renderer can render an inline error instead of an uncaught
 * exception toast.
 */
export class PrService extends Service.create({
  key: "pr",
  deps: {
  },
}) {
  evaluate() {
    // View *type* is `"git"` (matching the label the user sees);
    // the source directory + service `key` stay as `pr` for
    // historical reasons. Aligning the registered type with the
    // label keeps the command palette fuzzy match honest — a query
    // of `pr` shouldn't surface this view (the new `pull-requests`
    // view is the one that actually belongs to PR work).
    this.setup("register-view", () =>
      this.inject({
        name: "git",
        modulePath: "src/renderer/views/pr/pr-app.tsx",
        exportName: "PrApp",
        meta: { kind: "view", label: "Git" },
      }),
    )
  }

  /** Working tree + index status, plus current branch + ahead/behind. */
  async getStatus(args: { directory: string }): Promise<GitStatus> {
    const directory = args.directory
    if (!directory) {
      console.log("[pr.getStatus] empty directory, bailing")
      return emptyStatus(false)
    }

    const [statusOut, branchOut, numstatOut] = await Promise.all([
      runGit(["status", "--porcelain=v1", "-z", "--branch"], directory),
      runGit(["rev-parse", "--abbrev-ref", "HEAD"], directory),
      runGit(["diff", "--numstat"], directory),
    ])
    console.log("[pr.getStatus] git results", {
      directory,
      statusOutIsNull: statusOut == null,
      statusOutBytes: statusOut?.length ?? 0,
      statusOutPreview: statusOut?.slice(0, 400) ?? null,
      branchOut: branchOut?.trim() ?? null,
      numstatOutPreview: numstatOut?.slice(0, 200) ?? null,
    })
    if (statusOut == null) return emptyStatus(false)

    const numMap = parseNumstat(numstatOut ?? "")
    const { branch, upstream, ahead, behind, files } = parsePorcelain(
      statusOut,
      numMap,
    )
    console.log("[pr.getStatus] parsed", {
      directory,
      branch,
      upstream,
      ahead,
      behind,
      fileCount: files.length,
    })

    const current = (branchOut ?? "").trim() || branch
    return {
      ok: true,
      isRepo: true,
      branch: current || null,
      upstream,
      ahead,
      behind,
      detached: current === "HEAD",
      files,
    }
  }

  /** Working-tree diff for `path` (unstaged), or index diff when `staged`. */
  async getFileDiff(args: {
    directory: string
    path: string
    staged: boolean
    /** Untracked files have no diff against HEAD; pass true to render
     * them as a synthetic all-additions diff. */
    untracked?: boolean
  }): Promise<{ patch: string }> {
    if (args.untracked) {
      // Synthesize a diff that adds every line of the file.
      try {
        const fs = await import("node:fs/promises")
        const path = await import("node:path")
        const full = path.isAbsolute(args.path)
          ? args.path
          : path.join(args.directory, args.path)
        const content = await fs.readFile(full, "utf8")
        const lines = content.split("\n")
        if (content.endsWith("\n")) lines.pop()
        const header =
          `diff --git a/${args.path} b/${args.path}\n` +
          `new file mode 100644\n` +
          `--- /dev/null\n` +
          `+++ b/${args.path}\n` +
          `@@ -0,0 +1,${lines.length} @@\n`
        const body = lines.map(l => `+${l}`).join("\n")
        return { patch: header + body + (body ? "\n" : "") }
      } catch (err) {
        return { patch: "" }
      }
    }
    const argv = ["diff", "--no-color", "--no-ext-diff"]
    if (args.staged) argv.push("--cached")
    argv.push("--", args.path)
    const out = await runGit(argv, args.directory)
    return { patch: out ?? "" }
  }

  /** Full working-tree diff against HEAD (unstaged + staged combined). */
  async getWorkingTreeDiff(args: { directory: string }): Promise<{
    patch: string
  }> {
    const out = await runGit(
      ["diff", "--no-color", "--no-ext-diff", "HEAD"],
      args.directory,
    )
    return { patch: out ?? "" }
  }

  /** Recent commits, newest first. */
  async getHistory(args: {
    directory: string
    limit?: number
    skip?: number
    ref?: string
  }): Promise<{ ok: boolean; commits: GitCommit[] }> {
    const limit = args.limit ?? 200
    const skip = args.skip ?? 0
    const ref = args.ref ?? "HEAD"
    const SEP = "\x1f"
    const REC = "\x1e"
    const format = [
      "%H",
      "%h",
      "%P",
      "%an",
      "%ae",
      "%at",
      "%D",
      "%s",
      "%b",
    ].join(SEP)
    const out = await runGit(
      [
        "log",
        `--max-count=${limit}`,
        `--skip=${skip}`,
        `--pretty=format:${format}${REC}`,
        ref,
      ],
      args.directory,
    )
    if (out == null) return { ok: false, commits: [] }
    const commits: GitCommit[] = []
    for (const raw of out.split(REC)) {
      const entry = raw.replace(/^\n/, "")
      if (!entry) continue
      const parts = entry.split(SEP)
      if (parts.length < 9) continue
      const [sha, shortSha, parentStr, an, ae, atStr, refs, subject, body] =
        parts
      commits.push({
        sha,
        shortSha,
        parents: parentStr ? parentStr.split(" ").filter(Boolean) : [],
        authorName: an,
        authorEmail: ae,
        authorDate: Number(atStr) * 1000,
        refs,
        subject,
        body,
      })
    }
    return { ok: true, commits }
  }

  /** Patch for a single commit (against its first parent). */
  async getCommitDiff(args: {
    directory: string
    sha: string
  }): Promise<{ patch: string }> {
    const out = await runGit(
      [
        "show",
        "--no-color",
        "--no-ext-diff",
        "--format=",
        "--patch",
        args.sha,
      ],
      args.directory,
    )
    return { patch: out ?? "" }
  }

  /** Local + remote branches. */
  async getBranches(args: {
    directory: string
  }): Promise<{ ok: boolean; branches: GitBranch[]; current: string | null }> {
    const out = await runGit(
      [
        "for-each-ref",
        "--format=%(refname)%00%(refname:short)%00%(upstream:short)%00%(objectname)%00%(committerdate:unix)%00%(HEAD)%00%(contents:subject)",
        "refs/heads",
        "refs/remotes",
      ],
      args.directory,
    )
    if (out == null) return { ok: false, branches: [], current: null }
    const branches: GitBranch[] = []
    let current: string | null = null
    for (const rawLine of out.split("\n")) {
      const line = rawLine.trimEnd()
      if (!line) continue
      const [refname, shortName, upstream, headSha, unix, head, subject] =
        line.split("\x00")
      const remote = refname.startsWith("refs/remotes/")
      // Skip remote HEAD symbolic refs (e.g. origin/HEAD -> origin/main).
      if (remote && shortName.endsWith("/HEAD")) continue
      const isCurrent = head === "*"
      if (isCurrent) current = shortName
      branches.push({
        name: refname,
        shortName,
        remote,
        isCurrent,
        upstream: upstream || null,
        headSha: headSha ?? "",
        lastCommitAt: Number(unix) * 1000 || 0,
        subject: subject ?? "",
      })
    }
    branches.sort((a, b) => b.lastCommitAt - a.lastCommitAt)
    return { ok: true, branches, current }
  }

  async stageFiles(args: {
    directory: string
    paths: string[]
  }): Promise<GitResult> {
    if (!args.paths.length) return { ok: true }
    return runMutation("git", ["add", "--", ...args.paths], args.directory)
  }

  async unstageFiles(args: {
    directory: string
    paths: string[]
  }): Promise<GitResult> {
    if (!args.paths.length) return { ok: true }
    return runMutation(
      "git",
      ["reset", "HEAD", "--", ...args.paths],
      args.directory,
    )
  }

  async stageAll(args: { directory: string }): Promise<GitResult> {
    return runMutation("git", ["add", "-A"], args.directory)
  }

  async unstageAll(args: { directory: string }): Promise<GitResult> {
    return runMutation("git", ["reset", "HEAD"], args.directory)
  }

  /** Discards working-tree changes (and removes untracked files). */
  async discardFiles(args: {
    directory: string
    paths: string[]
  }): Promise<GitResult> {
    if (!args.paths.length) return { ok: true }
    // First reset index entries (for files that are staged), then
    // restore worktree, then clean any still-untracked entries.
    try {
      await execFileP("git", ["reset", "HEAD", "--", ...args.paths], {
        cwd: args.directory,
        maxBuffer: MAX_BUFFER,
      })
    } catch {
      // ignore — file may not be in the index.
    }
    try {
      await execFileP("git", ["checkout", "--", ...args.paths], {
        cwd: args.directory,
        maxBuffer: MAX_BUFFER,
      })
    } catch {
      // ignore — file may be untracked.
    }
    try {
      await execFileP("git", ["clean", "-fd", "--", ...args.paths], {
        cwd: args.directory,
        maxBuffer: MAX_BUFFER,
      })
    } catch (err) {
      return toError(err)
    }
    return { ok: true }
  }

  async commit(args: {
    directory: string
    message: string
    body?: string
    /** When true, only commits already-staged files. Otherwise runs
     *  `git add -A` first. */
    onlyStaged?: boolean
    amend?: boolean
  }): Promise<GitResult> {
    const message = args.message?.trim()
    if (!args.amend && !message) {
      return { ok: false, error: "Commit message is required" }
    }
    try {
      if (!args.onlyStaged) {
        await execFileP("git", ["add", "-A"], {
          cwd: args.directory,
          maxBuffer: MAX_BUFFER,
        })
      }
      const argv = ["commit"]
      if (args.amend) argv.push("--amend")
      if (message) {
        argv.push("-m", message)
        if (args.body && args.body.trim()) argv.push("-m", args.body.trim())
      } else if (args.amend) {
        argv.push("--no-edit")
      }
      await execFileP("git", argv, {
        cwd: args.directory,
        maxBuffer: MAX_BUFFER,
      })
      return { ok: true }
    } catch (err) {
      return toError(err)
    }
  }

  async fetch(args: { directory: string }): Promise<GitResult> {
    return runMutation("git", ["fetch", "--all", "--prune"], args.directory)
  }

  async pull(args: {
    directory: string
    rebase?: boolean
  }): Promise<GitResult> {
    const argv = ["pull"]
    if (args.rebase) argv.push("--rebase")
    return runMutation("git", argv, args.directory)
  }

  async push(args: {
    directory: string
    setUpstream?: boolean
    force?: boolean
  }): Promise<GitResult> {
    const argv = ["push"]
    if (args.force) argv.push("--force-with-lease")
    if (args.setUpstream) {
      const branch = (
        await runGit(["rev-parse", "--abbrev-ref", "HEAD"], args.directory)
      )?.trim()
      if (!branch || branch === "HEAD") {
        return { ok: false, error: "No current branch to push" }
      }
      argv.push("--set-upstream", "origin", branch)
    }
    return runMutation("git", argv, args.directory)
  }

  async checkout(args: {
    directory: string
    branch: string
  }): Promise<GitResult> {
    return runMutation("git", ["checkout", args.branch], args.directory)
  }

  async createBranch(args: {
    directory: string
    name: string
    /** Source ref; defaults to current HEAD. */
    from?: string
    checkout?: boolean
  }): Promise<GitResult> {
    const name = args.name?.trim()
    if (!name) return { ok: false, error: "Branch name is required" }
    const argv: string[] = args.checkout
      ? ["checkout", "-b", name]
      : ["branch", name]
    if (args.from) argv.push(args.from)
    return runMutation("git", argv, args.directory)
  }

  async deleteBranch(args: {
    directory: string
    name: string
    force?: boolean
  }): Promise<GitResult> {
    const argv = ["branch", args.force ? "-D" : "-d", args.name]
    return runMutation("git", argv, args.directory)
  }
}

type GitResult = { ok: true } | { ok: false; error: string }

async function runGit(
  argv: string[],
  cwd: string,
): Promise<string | null> {
  try {
    const { stdout } = await execFileP("git", argv, {
      cwd,
      maxBuffer: MAX_BUFFER,
    })
    return stdout
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string }
    if (e.stdout != null) return e.stdout
    return null
  }
}

async function runMutation(
  cmd: string,
  argv: string[],
  cwd: string,
): Promise<GitResult> {
  try {
    await execFileP(cmd, argv, { cwd, maxBuffer: MAX_BUFFER })
    return { ok: true }
  } catch (err) {
    return toError(err)
  }
}

function toError(err: unknown): { ok: false; error: string } {
  const e = err as NodeJS.ErrnoException & {
    stdout?: string
    stderr?: string
  }
  const detail =
    (e.stderr && e.stderr.toString().trim()) ||
    (e.stdout && e.stdout.toString().trim()) ||
    (err instanceof Error ? err.message : String(err)) ||
    "git command failed"
  return { ok: false, error: detail }
}

function emptyStatus(isRepo: boolean): GitStatus {
  return {
    ok: isRepo,
    isRepo,
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    detached: false,
    files: [],
  }
}

function parseNumstat(text: string): Map<string, {
  additions: number
  deletions: number
  binary: boolean
}> {
  const out = new Map<string, {
    additions: number
    deletions: number
    binary: boolean
  }>()
  for (const line of text.split("\n")) {
    if (!line) continue
    const parts = line.split("\t")
    if (parts.length < 3) continue
    const a = parts[0]
    const d = parts[1]
    const p = parts.slice(2).join("\t")
    const binary = a === "-" || d === "-"
    out.set(p, {
      additions: binary ? 0 : parseInt(a, 10) || 0,
      deletions: binary ? 0 : parseInt(d, 10) || 0,
      binary,
    })
  }
  return out
}

function parsePorcelain(
  raw: string,
  numMap: Map<string, {
    additions: number
    deletions: number
    binary: boolean
  }>,
): {
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  files: GitFileStatus[]
} {
  const files: GitFileStatus[] = []
  let branch: string | null = null
  let upstream: string | null = null
  let ahead = 0
  let behind = 0

  let i = 0
  while (i < raw.length) {
    // porcelain v1 with --branch starts with one or more header lines
    // that begin with "## ". Header lines end at \n, not \0.
    if (raw[i] === "#" && raw[i + 1] === "#") {
      // With `-z`, git terminates *every* record (including the
      // `## branch...upstream` header) with NUL, not \n. Older
      // versions of this parser only looked for \n, which meant the
      // header swallowed the entire payload and the file list came
      // back empty. Accept whichever terminator comes first.
      const nul = raw.indexOf("\0", i)
      const nl = raw.indexOf("\n", i)
      const candidates = [nul, nl].filter(x => x !== -1)
      const end = candidates.length === 0 ? raw.length : Math.min(...candidates)
      const header = raw.slice(i + 3, end)
      // header forms:
      //   "branch...nothing"   (initial repo, no commits)
      //   "main"               (no upstream)
      //   "main...origin/main [ahead 1, behind 2]"
      const m = header.match(
        /^(?:No commits yet on )?(\S+?)(?:\.\.\.(\S+))?(?:\s+\[(.*)\])?$/,
      )
      if (m) {
        branch = m[1] ?? null
        upstream = m[2] ?? null
        const bracket = m[3] ?? ""
        const aMatch = bracket.match(/ahead (\d+)/)
        const bMatch = bracket.match(/behind (\d+)/)
        if (aMatch) ahead = parseInt(aMatch[1], 10)
        if (bMatch) behind = parseInt(bMatch[1], 10)
      }
      i = end >= raw.length ? raw.length : end + 1
      continue
    }
    // file entry: XY space path \0 [oldPath \0]
    if (i + 3 > raw.length) break
    const code = raw.slice(i, i + 2)
    const indexStatus = code[0]
    const workStatus = code[1]
    const nul = raw.indexOf("\0", i + 3)
    if (nul === -1) break
    const newPath = raw.slice(i + 3, nul)
    let oldPath: string | null = null
    let next = nul + 1
    if (indexStatus === "R" || indexStatus === "C") {
      const oldNul = raw.indexOf("\0", next)
      if (oldNul === -1) break
      oldPath = raw.slice(next, oldNul)
      next = oldNul + 1
    }
    const untracked = code === "??"
    const ignored = code === "!!"
    if (!ignored) {
      const num = numMap.get(newPath)
      files.push({
        path: newPath,
        oldPath,
        code,
        indexStatus,
        workStatus,
        staged: !untracked && indexStatus !== " " && indexStatus !== "?",
        unstaged: untracked || (workStatus !== " " && workStatus !== "?"),
        untracked,
        additions: num?.additions ?? 0,
        deletions: num?.deletions ?? 0,
        binary: num?.binary ?? false,
      })
    }
    i = next
  }

  files.sort((a, b) => a.path.localeCompare(b.path))
  return { branch, upstream, ahead, behind, files }
}
