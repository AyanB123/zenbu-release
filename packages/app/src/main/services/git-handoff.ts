import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { Service } from "@zenbujs/core/runtime"
import { DbService, RpcService } from "@zenbujs/core/services"

const execFileP = promisify(execFile)

/**
 * `/worktree-handoff`: bring the commits from one worktree onto
 * another worktree's branch. Sister to `/workspace` (which creates
 * worktrees) — this one moves work *between* them.
 *
 * The big design decisions, with rationales:
 *
 *   1. **Cherry-pick, not merge.** The user said "I just want the
 *      commits on the other branch". Cherry-pick replays each commit
 *      as its own commit on the target, preserving author/date/msg
 *      one-for-one. A merge would either fast-forward (losing the
 *      target's independent history) or create a merge commit
 *      (extra noise). Cherry-pick matches the stated intent
 *      exactly.
 *
 *   2. **Pre-detect conflicts.** Doing the cherry-pick first and
 *      then unwinding on conflict is messy (you have a half-applied
 *      target). `git merge-tree --write-tree --merge-base=<base>`
 *      (git ≥2.38) does a non-destructive 3-way merge and tells us
 *      up front whether there's a conflict. We bail to the
 *      "conflict" stage in that case with no side effects on disk.
 *
 *   3. **Stash on the target, not the source.** If the target is
 *      dirty when we cherry-pick, git refuses. Stashing the
 *      target's uncommitted changes first and popping at the end
 *      is the standard recipe and survives normal cases. If the
 *      pop conflicts (uncommon — would require target's local
 *      changes to overlap with the new commits' touched paths) we
 *      leave the stash on the stack and surface a warning rather
 *      than try to be clever.
 *
 *   4. **Source dirty-work is committed before computing the rev
 *      range.** Otherwise we'd miss the uncommitted work entirely.
 *      The commit message is user-supplied (with an empty-input
 *      fallback to an auto-generated marker), keeping the panel
 *      ergonomic (one input does the right thing).
 *
 *   5. **"Resolve with agent" is one-way.** Once the user picks
 *      that, we fire an `appendComposerDraft` event that drops a
 *      prompt into the composer and close the panel. The user can
 *      edit and submit. The agent's cwd stays in the source
 *      worktree (that's its current chat scope); the prompt names
 *      the target directory explicitly so `bash` can `cd` there.
 *      We do NOT mutate disk in that branch — the agent owns the
 *      whole resolution.
 */

export type HandoffTarget = {
  scopeId: string
  directory: string
  branch: string | null
  /** Number of distinct commits on this worktree's branch ahead of
   * the source branch. Informational; helps the user know which
   * branch is "behind". */
  commitsBehindSource: number
  /** True if this is the same branch as the source. We still list
   * it (some workflows want to move work between two checkouts of
   * the same branch — uncommon but valid) but the UI dims it. */
  sameBranchAsSource: boolean
}

export type HandoffInspectResult = {
  /** Repo + branch info, for the preview banner. */
  source: {
    directory: string
    branch: string
    dirty: boolean
    /** Number of dirty files (tracked + untracked). Cosmetic. */
    dirtyFileCount: number
  }
  target: {
    directory: string
    branch: string
    dirty: boolean
    dirtyFileCount: number
  }
  /**
   * Commits that will be transferred. Computed as the asymmetric
   * difference `target..source` — i.e. commits reachable from
   * source but not from target. If the source is dirty, an
   * additional synthetic "uncommitted" entry is prepended (the
   * user's pending changes, which we'll commit on apply).
   */
  commits: Array<{
    sha: string
    shortSha: string
    subject: string
    author: string
  }>
  /** True iff there's something to transfer (commits OR dirty source). */
  hasWork: boolean
  /** When the merge would conflict, the list of paths involved and
   * a small diff preview. `null` means no conflict (or we couldn't
   * pre-check, in which case the apply step will surface the
   * failure). */
  conflict: {
    files: string[]
    /** Truncated `git diff base..source` for the conflict-resolution
     * prompt. Capped to keep both the panel preview and the agent
     * prompt manageable. */
    diffPreview: string
  } | null
}

type ConflictInfo = NonNullable<HandoffInspectResult["conflict"]>

export class GitHandoffService extends Service.create({
  key: "gitHandoff",
  deps: { db: DbService, rpc: RpcService },
}) {
  /**
   * Look at the two worktrees and return a preview of the operation
   * without touching disk. Safe to call repeatedly — used for the
   * panel's "inspecting" stage.
   */
  async inspect(args: {
    sourceScopeId: string
    targetScopeId: string
  }): Promise<HandoffInspectResult> {
    const { sourceDir, targetDir } = this.requireScopes(args)

    const [
      sourceBranch,
      targetBranch,
      sourceStatus,
      targetStatus,
    ] = await Promise.all([
      currentBranch(sourceDir),
      currentBranch(targetDir),
      porcelainStatus(sourceDir),
      porcelainStatus(targetDir),
    ])

    if (!sourceBranch) {
      throw new Error(
        `source worktree is on a detached HEAD (${sourceDir})`,
      )
    }
    if (!targetBranch) {
      throw new Error(
        `target worktree is on a detached HEAD (${targetDir})`,
      )
    }

    const base = await mergeBase(sourceDir, targetBranch, sourceBranch)

    // Committed commits on the source not yet on target. We
    // intentionally use the source worktree for the rev-list so the
    // branch name resolves to the same object git uses for everything
    // else here. `--reverse` so the apply order is chronological.
    const commits = await listCommits(
      sourceDir,
      base ? `${base}..${sourceBranch}` : sourceBranch,
    )

    // If the source is dirty we synthesize a "pending" entry so the
    // user can see in the preview that those changes will be
    // captured as a commit before transfer.
    if (sourceStatus.dirty) {
      commits.unshift({
        sha: "PENDING",
        shortSha: "PENDING",
        subject: `(uncommitted: ${sourceStatus.fileCount} file${
          sourceStatus.fileCount === 1 ? "" : "s"
        })`,
        author: "you",
      })
    }

    const hasWork = commits.length > 0

    // Conflict pre-check. We use `merge-tree --write-tree` (modern
    // form, git ≥2.38) which exits non-zero on conflict and emits
    // the conflict info on stdout/stderr. We deliberately do this
    // *only when* there's something to transfer.
    let conflict: ConflictInfo | null = null
    if (hasWork && base) {
      // Account for dirty source: the conflict pre-check should
      // include the source's uncommitted changes too, otherwise
      // we'd say "clean" and then hit a real conflict at apply
      // time. The cheapest way to fold them in: build a temporary
      // tree object from the source's working dir state and merge
      // that against the target. But that's surgery — for v1 we
      // pre-check only the committed range, and rely on the
      // cherry-pick step itself to surface late-discovered
      // conflicts (which the user can re-route via the agent).
      conflict = await detectConflict(
        sourceDir,
        base,
        targetBranch,
        sourceBranch,
      )
    }

    return {
      source: {
        directory: sourceDir,
        branch: sourceBranch,
        dirty: sourceStatus.dirty,
        dirtyFileCount: sourceStatus.fileCount,
      },
      target: {
        directory: targetDir,
        branch: targetBranch,
        dirty: targetStatus.dirty,
        dirtyFileCount: targetStatus.fileCount,
      },
      commits,
      hasWork,
      conflict,
    }
  }

  /**
   * Execute the handoff. Caller is responsible for having shown the
   * preview and confirmed; we do still revalidate (status + commits)
   * to catch races between inspect() and apply().
   */
  async apply(args: {
    sourceScopeId: string
    targetScopeId: string
    /** Commit message used if the source has uncommitted changes.
     * Empty string → auto-generated marker. */
    sourceCommitMessage: string
  }): Promise<
    | { ok: true; appliedCommits: number; warnings: string[] }
    | { ok: false; error: string }
  > {
    const { sourceDir, targetDir } = this.requireScopes(args)
    const warnings: string[] = []

    const sourceBranch = await currentBranch(sourceDir)
    const targetBranch = await currentBranch(targetDir)
    if (!sourceBranch) {
      return {
        ok: false,
        error: `source worktree is on a detached HEAD (${sourceDir})`,
      }
    }
    if (!targetBranch) {
      return {
        ok: false,
        error: `target worktree is on a detached HEAD (${targetDir})`,
      }
    }

    // 1. Commit any uncommitted source changes first so they get
    //    rolled into the rev range.
    const sourceStatus = await porcelainStatus(sourceDir)
    if (sourceStatus.dirty) {
      const message =
        args.sourceCommitMessage.trim() ||
        `auto-generated commit (worktree handoff to ${targetBranch})`
      try {
        await execFileP("git", ["-C", sourceDir, "add", "-A"])
        await execFileP("git", ["-C", sourceDir, "commit", "-m", message])
      } catch (err) {
        return { ok: false, error: gitErrorMessage(err, "commit") }
      }
    }

    // 2. Recompute the rev range now that the source is clean.
    const base = await mergeBase(sourceDir, targetBranch, sourceBranch)
    const commits = await listCommits(
      sourceDir,
      base ? `${base}..${sourceBranch}` : sourceBranch,
    )
    if (commits.length === 0) {
      return {
        ok: false,
        error: "Nothing to hand off: source and target are in sync.",
      }
    }

    // 3. Stash on the target if needed. We mark the stash with a
    //    recognizable message so the user can find it if anything
    //    goes wrong and we have to leave it on the stack.
    const targetStatus = await porcelainStatus(targetDir)
    let stashed = false
    if (targetStatus.dirty) {
      try {
        await execFileP("git", [
          "-C",
          targetDir,
          "stash",
          "push",
          "--include-untracked",
          "-m",
          `worktree-handoff (auto-stash from ${sourceBranch})`,
        ])
        stashed = true
      } catch (err) {
        return { ok: false, error: gitErrorMessage(err, "stash") }
      }
    }

    // 4. Cherry-pick the commits one by one. If any step fails
    //    (e.g. the pre-check missed a conflict), we abort cleanly
    //    and surface the error.
    try {
      for (const c of commits) {
        await execFileP("git", [
          "-C",
          targetDir,
          "cherry-pick",
          c.sha,
        ])
      }
    } catch (err) {
      // Best-effort recovery: abort the in-progress cherry-pick and
      // restore the user's stash so the target is back where it
      // started.
      try {
        await execFileP("git", ["-C", targetDir, "cherry-pick", "--abort"])
      } catch {
        /* ignore — no cherry-pick in progress */
      }
      if (stashed) {
        try {
          await execFileP("git", ["-C", targetDir, "stash", "pop"])
        } catch {
          warnings.push(
            "stash was left on the target's stash stack — run `git stash list` to inspect",
          )
        }
      }
      return { ok: false, error: gitErrorMessage(err, "cherry-pick") }
    }

    // 5. Pop the stash. If it conflicts, leave it on the stack and
    //    warn — recovering from that automatically is a rabbit hole
    //    and out of scope.
    if (stashed) {
      try {
        await execFileP("git", ["-C", targetDir, "stash", "pop"])
      } catch (err) {
        warnings.push(
          `${gitErrorMessage(err, "stash pop")} — the auto-stash was left on the target's stash stack`,
        )
      }
    }

    return { ok: true, appliedCommits: commits.length, warnings }
  }

  /**
   * Build a merge-resolution prompt from the inspect result and
   * inject it into the composer of the given chat via the existing
   * `appendComposerDraft` event. Renderer's Composer subscribes to
   * that event keyed by `composerId === chat.id`.
   *
   * Caller responsibilities:
   *   - Has already shown the conflict preview in the panel.
   *   - Knows this is one-way: after this fires, the panel should
   *     close and the user takes over.
   */
  async prepareAgentResolution(args: {
    chatId: string
    sourceScopeId: string
    targetScopeId: string
  }): Promise<void> {
    const preview = await this.inspect({
      sourceScopeId: args.sourceScopeId,
      targetScopeId: args.targetScopeId,
    })
    const conflict = preview.conflict
    const filesBlock = conflict
      ? conflict.files.map(f => `- ${f}`).join("\n")
      : "(no specific files flagged — re-run `git merge-tree` or attempt the cherry-pick to surface conflicts)"
    const diffBlock = conflict?.diffPreview
      ? "\n\n```diff\n" + conflict.diffPreview + "\n```\n"
      : ""

    // The prompt is intentionally directive but leaves the agent
    // some autonomy on how to apply the resolution (cd + cherry-pick,
    // edit + commit, etc.). Naming both directories explicitly so
    // the agent doesn't have to guess.
    const text = [
      `Please bring the changes from \`${preview.source.branch}\` (worktree: \`${preview.source.directory}\`)`,
      `into \`${preview.target.branch}\` (worktree: \`${preview.target.directory}\`).`,
      ``,
      `A clean cherry-pick would conflict. Conflicting files:`,
      filesBlock,
      diffBlock,
      `Plan:`,
      `1. cd into the target worktree.`,
      `2. Cherry-pick the commits from the source branch one by one (or merge), resolving each conflict as it appears.`,
      `3. Commit the resolution.`,
      ``,
      `Tip: the merge base is whatever \`git merge-base ${preview.target.branch} ${preview.source.branch}\` returns from either worktree.`,
    ].join("\n")

    this.ctx.rpc.emit.app.appendComposerDraft({
      composerId: args.chatId,
      text,
    })
  }

  // ---- internals ----

  private requireScopes(args: {
    sourceScopeId: string
    targetScopeId: string
  }): { sourceDir: string; targetDir: string } {
    const root = this.ctx.db.client.readRoot()
    const source = root.app.scopes[args.sourceScopeId]
    const target = root.app.scopes[args.targetScopeId]
    if (!source) throw new Error(`unknown source scope ${args.sourceScopeId}`)
    if (!target) throw new Error(`unknown target scope ${args.targetScopeId}`)
    if (source.id === target.id) {
      throw new Error("source and target worktrees are the same")
    }
    return { sourceDir: source.directory, targetDir: target.directory }
  }
}

// ---- pure git helpers ----

async function currentBranch(dir: string): Promise<string | null> {
  try {
    const { stdout } = await execFileP("git", [
      "-C",
      dir,
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    ])
    const name = stdout.trim()
    if (!name || name === "HEAD") return null
    return name
  } catch {
    return null
  }
}

async function porcelainStatus(
  dir: string,
): Promise<{ dirty: boolean; fileCount: number }> {
  try {
    const { stdout } = await execFileP("git", [
      "-C",
      dir,
      "status",
      "--porcelain",
    ])
    const lines = stdout.split("\n").filter(Boolean)
    return { dirty: lines.length > 0, fileCount: lines.length }
  } catch {
    return { dirty: false, fileCount: 0 }
  }
}

async function mergeBase(
  dir: string,
  a: string,
  b: string,
): Promise<string | null> {
  try {
    const { stdout } = await execFileP("git", [
      "-C",
      dir,
      "merge-base",
      a,
      b,
    ])
    const sha = stdout.trim()
    return sha || null
  } catch {
    return null
  }
}

async function listCommits(
  dir: string,
  range: string,
): Promise<
  Array<{ sha: string; shortSha: string; subject: string; author: string }>
> {
  try {
    const { stdout } = await execFileP("git", [
      "-C",
      dir,
      "log",
      "--reverse",
      "--pretty=format:%H%x09%h%x09%an%x09%s",
      range,
    ])
    const out: Array<{
      sha: string
      shortSha: string
      subject: string
      author: string
    }> = []
    for (const line of stdout.split("\n")) {
      if (!line) continue
      const [sha, shortSha, author, ...rest] = line.split("\t")
      out.push({
        sha: sha ?? "",
        shortSha: shortSha ?? "",
        author: author ?? "",
        subject: rest.join("\t"),
      })
    }
    return out
  } catch {
    return []
  }
}

/**
 * Conflict pre-check via `git merge-tree --write-tree`. Returns
 * `null` if the merge would be clean. Returns conflict info
 * otherwise.
 *
 * Output contract (per `man git-merge-tree`):
 *   - Exit 0 → clean merge. stdout: `<merged tree OID>\n`.
 *   - Exit 1 → conflicts. stdout:
 *       <merged tree OID>\n
 *       <ls-tree-style "mode oid stage\tpath" lines for conflicts>\n
 *       \n
 *       Auto-merging <path>\n
 *       CONFLICT (…): …\n
 *       …
 *   - Other exits → the command itself failed (bad refs etc).
 *
 * We do NOT pass `--name-only`: it's only valid with the legacy
 * "trivial merge" form (`git merge-tree <base-tree> <b1> <b2>`),
 * not with `--write-tree`. Git rejects the combination with a
 * usage error (exit 129). Instead we parse the conflict-info
 * section ourselves: lines containing a tab carry the path after
 * the tab, and we dedupe them since the same path appears once per
 * conflict stage.
 *
 * For the diff preview we run a separate `git diff base..source`
 * — already formatted the way the agent prompt wants.
 */
async function detectConflict(
  dir: string,
  base: string,
  targetBranch: string,
  sourceBranch: string,
): Promise<ConflictInfo | null> {
  try {
    await execFileP("git", [
      "-C",
      dir,
      "merge-tree",
      "--write-tree",
      `--merge-base=${base}`,
      targetBranch,
      sourceBranch,
    ])
    // Exit 0 = clean merge.
    return null
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      stdout?: string
      stderr?: string
      code?: number
    }
    // merge-tree exits 1 specifically for conflicts. Other exit
    // codes mean the command itself failed (e.g. bad refs). We
    // treat unknown failures as "no conflict info available" rather
    // than fabricating a fake conflict — the apply step will
    // surface the real problem.
    const stdout = (e.stdout ?? "").toString()
    const stderr = (e.stderr ?? "").toString()
    if (e.code !== 1) {
      console.warn(
        "[git-handoff] merge-tree pre-check failed:",
        stderr || stdout || e.message,
      )
      return null
    }
    // Parse the conflict section: lines containing a tab are
    // ls-tree-style entries ("<mode> <oid> <stage>\t<path>"). Pick
    // the path after the tab and dedupe (same path can appear in
    // multiple stages). Everything before the first blank line is
    // the conflicting-entries section; lines after it are
    // human-readable messages we ignore.
    const seen = new Set<string>()
    for (const raw of stdout.split("\n")) {
      if (raw === "") break
      const tab = raw.indexOf("\t")
      if (tab < 0) continue
      const path = raw.slice(tab + 1)
      if (path) seen.add(path)
    }
    const files = [...seen]
    let diffPreview = ""
    try {
      const { stdout: diff } = await execFileP("git", [
        "-C",
        dir,
        "diff",
        `${base}..${sourceBranch}`,
        "--",
        ...files,
      ])
      // Cap at ~2KB. Keeps both the panel preview and the agent
      // prompt manageable.
      diffPreview =
        diff.length > 2048 ? diff.slice(0, 2048) + "\n…(truncated)" : diff
    } catch {
      diffPreview = ""
    }
    return { files, diffPreview }
  }
}

function gitErrorMessage(err: unknown, what: string): string {
  if (err && typeof err === "object") {
    const e = err as { stderr?: string; stdout?: string; message?: string }
    const detail =
      (e.stderr && String(e.stderr).trim()) ||
      (e.stdout && String(e.stdout).trim()) ||
      e.message ||
      `git ${what} failed`
    return detail
  }
  return `git ${what} failed`
}
