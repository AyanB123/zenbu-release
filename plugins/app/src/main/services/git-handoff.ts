import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { Service } from "@zenbujs/core/runtime"
import { DbService, RpcService } from "@zenbujs/core/services"

const execFileP = promisify(execFile)

/**
 * `/worktree-handoff`: land the source worktree's commits onto
 * another worktree's branch. Designed to be re-run; each invocation
 * advances the state machine by exactly ONE git operation and then
 * gets out of the user's way.
 *
 * Earlier versions of this file tried to do everything in one shot
 * (cherry-pick + merge-tree pre-check + stash dance + custom
 * conflict UI). That was overbuilt. The new model:
 *
 *   1. If source is behind/diverged from target → rebase source
 *      onto target. Done. User tests, then re-runs the command.
 *   2. If source is strictly ahead → fast-forward target's branch
 *      to source's HEAD. Done.
 *   3. Conflicts during step 1 → abort the rebase (leave a clean
 *      tree), drop the conflict info into the chat's composer via
 *      `appendComposerDraft`, close the panel. The agent takes
 *      over from there.
 *
 * Critically the panel never tries to do (1) then (2) in the same
 * run. The user wants to test after a rebase before landing the
 * commits anywhere, and a panel that auto-continues defeats that.
 */

export type HandoffInspectResult = {
  source: {
    directory: string
    branch: string
    dirty: boolean
    dirtyFileCount: number
  }
  target: {
    directory: string
    branch: string
    dirty: boolean
    dirtyFileCount: number
  }
  /** Commits reachable from source but not target — i.e. what
   * would land on target if we fast-forwarded right now. */
  sourceAhead: CommitSummary[]
  /** Commits reachable from target but not source — i.e. what
   * the source needs to absorb (via rebase) before it can land. */
  targetAhead: CommitSummary[]
  /** What to do next. Drives the renderer's single-button label. */
  recommendedAction:
    | { kind: "rebase"; reason: "behind" | "diverged" }
    | { kind: "fastForward" }
    | { kind: "noop" }
}

type CommitSummary = {
  sha: string
  shortSha: string
  subject: string
  author: string
}

export class GitHandoffService extends Service.create({
  key: "gitHandoff",
  deps: { db: DbService, rpc: RpcService },
}) {
  /** Read-only preview. Drives the panel's main-button label and
   * the "ahead by N" / "behind by N" line. Safe to call repeatedly. */
  async inspect(args: {
    sourceScopeId: string
    targetScopeId: string
  }): Promise<HandoffInspectResult> {
    const { sourceDir, targetDir } = this.requireScopes(args)

    const [sourceBranch, targetBranch, sourceStatus, targetStatus] =
      await Promise.all([
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

    const [sourceAhead, targetAhead] = await Promise.all([
      listCommits(sourceDir, `${targetBranch}..${sourceBranch}`),
      listCommits(sourceDir, `${sourceBranch}..${targetBranch}`),
    ])

    const recommendedAction: HandoffInspectResult["recommendedAction"] =
      targetAhead.length === 0 && sourceAhead.length === 0
        ? { kind: "noop" }
        : targetAhead.length > 0
          ? {
              kind: "rebase",
              reason: sourceAhead.length > 0 ? "diverged" : "behind",
            }
          : { kind: "fastForward" }

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
      sourceAhead,
      targetAhead,
      recommendedAction,
    }
  }

  /**
   * Commit the source worktree's uncommitted changes. Used by the
   * panel's askCommit step so the rebase has a clean tree to work
   * with. `message` is the user-typed commit message; empty →
   * auto-generated marker.
   */
  async commitSourceChanges(args: {
    sourceScopeId: string
    message: string
  }): Promise<
    | { ok: true; committed: boolean }
    | { ok: false; error: string }
  > {
    const root = this.ctx.db.client.readRoot()
    const source = root.app.scopes[args.sourceScopeId]
    if (!source) {
      return {
        ok: false,
        error: `unknown source scope ${args.sourceScopeId}`,
      }
    }
    const status = await porcelainStatus(source.directory)
    if (!status.dirty) return { ok: true, committed: false }
    const message =
      args.message.trim() ||
      `auto-generated commit (worktree handoff)`
    try {
      await execFileP("git", ["-C", source.directory, "add", "-A"])
      await execFileP("git", [
        "-C",
        source.directory,
        "commit",
        "-m",
        message,
      ])
      return { ok: true, committed: true }
    } catch (err) {
      return { ok: false, error: gitErrorMessage(err, "commit") }
    }
  }

  /**
   * Archive the source worktree's scope after a successful handoff.
   * Pure replica update; mirrors the agent-sidebar's
   * `archiveWorktreeScope` action (set `archived=true`, stamp
   * `archivedAt`).
   *
   * (Previously this was `markScopeCompleted` and wrote to a
   * separate `completed` flag. That bucket was folded into
   * `archived` in migration 73; the RPC was renamed so callers
   * stay honest about what the post-handoff action actually does.)
   *
   * Exposed as an RPC rather than a renderer-side update only so
   * the handoff panel can compose it into the same await chain as
   * the actual git operations — the renderer could equivalently
   * call `dbClient.update` directly.
   */
  async archiveScope(args: {
    scopeId: string
  }): Promise<{ ok: true }> {
    await this.ctx.db.client.update(root => {
      const s = root.app.scopes[args.scopeId]
      if (!s) return
      s.archived = true
      s.archivedAt = Date.now()
    })
    return { ok: true }
  }

  /**
   * Rebase the source worktree's branch onto the target branch.
   * Used when source is behind or diverged from target.
   *
   * On conflict: aborts the rebase (leaves a clean tree), emits an
   * `appendComposerDraft` event with the conflict info, and returns
   * `{ ok: false, reason: "conflicts" }`. The renderer closes the
   * panel; the user's composer has the prompt ready for the agent.
   */
  async rebaseSourceOntoTarget(args: {
    sourceScopeId: string
    targetScopeId: string
    chatId: string
  }): Promise<
    | { ok: true; rebasedCommits: number; targetBranch: string }
    | { ok: false; reason: "conflicts" }
    | { ok: false; reason: "error"; error: string }
  > {
    const { sourceDir, targetDir } = this.requireScopes(args)
    const sourceBranch = await currentBranch(sourceDir)
    const targetBranch = await currentBranch(targetDir)
    if (!sourceBranch) {
      return {
        ok: false,
        reason: "error",
        error: `source worktree is on a detached HEAD (${sourceDir})`,
      }
    }
    if (!targetBranch) {
      return {
        ok: false,
        reason: "error",
        error: `target worktree is on a detached HEAD (${targetDir})`,
      }
    }

    // Snapshot the pre-rebase head so we can give the agent a
    // useful diff even after we abort.
    const originalSourceHead = await revParse(sourceDir, "HEAD")

    // Stash source's uncommitted changes — git refuses rebase
    // otherwise. Marked so the user can find it if anything goes
    // sideways.
    const sourceStatus = await porcelainStatus(sourceDir)
    let stashed = false
    if (sourceStatus.dirty) {
      try {
        await execFileP("git", [
          "-C",
          sourceDir,
          "stash",
          "push",
          "--include-untracked",
          "-m",
          `worktree-handoff (auto-stash before rebase onto ${targetBranch})`,
        ])
        stashed = true
      } catch (err) {
        return {
          ok: false,
          reason: "error",
          error: gitErrorMessage(err, "stash"),
        }
      }
    }

    try {
      await execFileP("git", [
        "-C",
        sourceDir,
        "rebase",
        targetBranch,
      ])
    } catch (err) {
      // Distinguish conflict (exit 1 with unmerged paths) from
      // other failures (bad ref etc).
      const unmerged = await unmergedPaths(sourceDir)
      if (unmerged.length > 0) {
        const diffPreview = await diffForFiles(
          sourceDir,
          targetBranch,
          originalSourceHead,
          unmerged,
        )
        try {
          await execFileP("git", [
            "-C",
            sourceDir,
            "rebase",
            "--abort",
          ])
        } catch {
          /* rebase already torn down — fine */
        }
        if (stashed) {
          try {
            await execFileP("git", ["-C", sourceDir, "stash", "pop"])
          } catch {
            // Leaving the stash on the stack is fine — surface
            // through the composer prompt below.
          }
        }
        this.ctx.rpc.emit.app.appendComposerDraft({
          composerId: args.chatId,
          text: buildConflictPrompt({
            sourceBranch,
            targetBranch,
            sourceDir,
            files: unmerged,
            diffPreview,
          }),
        })
        return { ok: false, reason: "conflicts" }
      }

      // Non-conflict failure — try to leave the tree clean.
      try {
        await execFileP("git", ["-C", sourceDir, "rebase", "--abort"])
      } catch {
        /* nothing to abort */
      }
      if (stashed) {
        try {
          await execFileP("git", ["-C", sourceDir, "stash", "pop"])
        } catch {
          /* leave stash, user can recover */
        }
      }
      return {
        ok: false,
        reason: "error",
        error: gitErrorMessage(err, "rebase"),
      }
    }

    if (stashed) {
      try {
        await execFileP("git", ["-C", sourceDir, "stash", "pop"])
      } catch (err) {
        // Stash pop conflicted — uncommon, but possible if the
        // stashed changes overlap with the newly-rebased work.
        // Surface as a soft error: the rebase itself succeeded.
        return {
          ok: false,
          reason: "error",
          error: `${gitErrorMessage(
            err,
            "stash pop",
          )} — rebase succeeded, but your stashed changes conflict. Run \`git stash list\` in the source worktree to recover.`,
        }
      }
    }

    // Count how many commits actually moved (could be 0 if the
    // rebase was a no-op fast-forward).
    const replayed = await listCommits(
      sourceDir,
      `${targetBranch}..${sourceBranch}`,
    )
    return {
      ok: true,
      rebasedCommits: replayed.length,
      targetBranch,
    }
  }

  /**
   * Fast-forward the target's branch to source's HEAD. Used when
   * source is strictly ahead of target (the post-rebase steady
   * state). Refuses if not actually fast-forwardable.
   */
  async fastForwardTargetToSource(args: {
    sourceScopeId: string
    targetScopeId: string
  }): Promise<
    | { ok: true; landedCommits: number; targetBranch: string }
    | { ok: false; error: string }
  > {
    const { sourceDir, targetDir } = this.requireScopes(args)
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

    // Sanity check: count commits in each direction. If target is
    // ahead at all, FF would lose history — bail.
    const targetAhead = await listCommits(
      sourceDir,
      `${sourceBranch}..${targetBranch}`,
    )
    if (targetAhead.length > 0) {
      return {
        ok: false,
        error: `Can't fast-forward: \`${targetBranch}\` has ${targetAhead.length} commit${
          targetAhead.length === 1 ? "" : "s"
        } that \`${sourceBranch}\` doesn't. Re-run \`/worktree-handoff\` to rebase first.`,
      }
    }
    const sourceAhead = await listCommits(
      sourceDir,
      `${targetBranch}..${sourceBranch}`,
    )
    if (sourceAhead.length === 0) {
      return {
        ok: false,
        error: `Nothing to land: \`${targetBranch}\` is already up to date with \`${sourceBranch}\`.`,
      }
    }

    // Stash target if dirty so the FF doesn't fight working-tree
    // changes. Symmetric to the rebase path.
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
          `worktree-handoff (auto-stash before fast-forward from ${sourceBranch})`,
        ])
        stashed = true
      } catch (err) {
        return { ok: false, error: gitErrorMessage(err, "stash") }
      }
    }

    try {
      await execFileP("git", [
        "-C",
        targetDir,
        "merge",
        "--ff-only",
        sourceBranch,
      ])
    } catch (err) {
      if (stashed) {
        try {
          await execFileP("git", ["-C", targetDir, "stash", "pop"])
        } catch {
          /* leave stash for user */
        }
      }
      return { ok: false, error: gitErrorMessage(err, "merge --ff-only") }
    }

    if (stashed) {
      try {
        await execFileP("git", ["-C", targetDir, "stash", "pop"])
      } catch (err) {
        return {
          ok: false,
          error: `${gitErrorMessage(
            err,
            "stash pop",
          )} — fast-forward succeeded, but the target's stashed changes conflict. Run \`git stash list\` in \`${targetDir}\` to recover.`,
        }
      }
    }

    return {
      ok: true,
      landedCommits: sourceAhead.length,
      targetBranch,
    }
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

async function revParse(dir: string, rev: string): Promise<string> {
  try {
    const { stdout } = await execFileP("git", [
      "-C",
      dir,
      "rev-parse",
      rev,
    ])
    return stdout.trim()
  } catch {
    return rev
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

async function listCommits(
  dir: string,
  range: string,
): Promise<CommitSummary[]> {
  try {
    const { stdout } = await execFileP("git", [
      "-C",
      dir,
      "log",
      "--reverse",
      "--pretty=format:%H%x09%h%x09%an%x09%s",
      range,
    ])
    const out: CommitSummary[] = []
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

async function unmergedPaths(dir: string): Promise<string[]> {
  try {
    const { stdout } = await execFileP("git", [
      "-C",
      dir,
      "diff",
      "--name-only",
      "--diff-filter=U",
    ])
    return stdout
      .split("\n")
      .map(l => l.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

async function diffForFiles(
  dir: string,
  base: string,
  tip: string,
  files: string[],
): Promise<string> {
  if (files.length === 0) return ""
  try {
    const { stdout } = await execFileP("git", [
      "-C",
      dir,
      "diff",
      `${base}..${tip}`,
      "--",
      ...files,
    ])
    // Cap at ~2KB so the composer doesn't explode.
    return stdout.length > 2048
      ? stdout.slice(0, 2048) + "\n…(truncated)"
      : stdout
  } catch {
    return ""
  }
}

function buildConflictPrompt(args: {
  sourceBranch: string
  targetBranch: string
  sourceDir: string
  files: string[]
  diffPreview: string
}): string {
  const filesBlock = args.files.map(f => `- ${f}`).join("\n")
  const diffBlock = args.diffPreview
    ? "\n\n```diff\n" + args.diffPreview + "\n```\n"
    : ""
  return [
    `Rebasing \`${args.sourceBranch}\` onto \`${args.targetBranch}\` hit conflicts. The rebase has been aborted; the worktree is clean.`,
    ``,
    `Conflicting files:`,
    filesBlock,
    diffBlock,
    `Please:`,
    `1. \`cd ${args.sourceDir}\``,
    `2. \`git rebase ${args.targetBranch}\``,
    `3. Resolve each conflict, then \`git rebase --continue\`.`,
    `4. Run the app and confirm everything still works.`,
    `5. Re-run \`/worktree-handoff\` to land the commits on \`${args.targetBranch}\`.`,
  ].join("\n")
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
