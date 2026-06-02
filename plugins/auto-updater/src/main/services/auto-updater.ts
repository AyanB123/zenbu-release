import { promisify } from "node:util"
import { execFile } from "node:child_process"
import { Service } from "@zenbujs/core/runtime"

const NAME = "auto-updater-button"

const execFileP = promisify(execFile)

/** Hard cap on the per-file diff we ship back to the renderer.
 * The modal has a max height and the prompt is meant to be
 * pasted to an agent — anything bigger isn't useful, and a
 * pathological binary file would otherwise wedge the IPC. */
const MAX_DIFF_BYTES = 32 * 1024

type DiffEntry = {
  path: string
  /** Working tree (incl. uncommitted edits) vs HEAD. Empty when
   * there are no local changes. */
  local: string
  /** HEAD vs the incoming target commit. Empty when the remote
   * doesn't touch this file. */
  incoming: string
  truncated: boolean
  error: string | null
}

/**
 * Title-bar auto-updater service.
 *
 * The whole "is there an update?" check is delegated to the
 * core `pluginUpdater` service; this plugin only contributes the
 * top-right title-bar button + conflicts modal. The renderer
 * polls `pluginUpdater.checkAll()` directly every 10s, so there
 * is no main-side timer — the only RPC we own is
 * `getConflictDiffs`, used by the modal's "Copy prompt" button.
 *
 * Diffs are computed by shelling out to `git`. We deliberately
 * use the system git here instead of isomorphic-git because:
 *
 *  - It's already a hard dependency of the host (every plugin
 *    repo is a git checkout to begin with).
 *  - Producing a readable unified diff from isomorphic-git would
 *    mean pulling in another diff library and re-implementing
 *    rename detection / context handling, when `git diff` already
 *    does exactly what the agent prompt needs.
 */
export class AutoUpdaterService extends Service.create({
  key: "autoUpdater",
}) {
  evaluate() {
    this.setup("inject-view", () =>
      this.inject({
        name: NAME,
        modulePath: "./src/views/auto-updater-view.tsx",
        meta: {
          // Sits at the rightmost edge of the title bar's plugin
          // slot — past `open-in` (1) and `play` (2) — so the
          // update indicator is the last thing before the
          // window's right-sidebar toggle.
          kind: "title-bar",
          order: 10,
          label: "Updates",
        },
      }),
    )
  }

  /**
   * Collect unified diffs for the files blocking an update so the
   * renderer can ship them to an agent as a single prompt. For
   * each file we attach two diffs:
   *
   *  - `local`    — working tree vs HEAD (uncommitted edits).
   *  - `incoming` — HEAD vs the fetched target commit (what the
   *                 update would bring in).
   *
   * Either can be empty: a "dirty file" conflict only has a
   * `local` diff, a clean-tree merge conflict only has an
   * `incoming` diff, and a file that diverged on both sides has
   * both. The renderer renders whichever are non-empty.
   */
  async getConflictDiffs(args: {
    repoPath: string
    target: string
    files: string[]
  }): Promise<{ diffs: DiffEntry[] }> {
    const { repoPath, target, files } = args
    const seen = new Set<string>()
    const diffs: DiffEntry[] = []
    for (const file of files) {
      if (seen.has(file)) continue
      seen.add(file)
      diffs.push(await this.diffOne(repoPath, target, file))
    }
    return { diffs }
  }

  private async diffOne(
    repoPath: string,
    target: string,
    file: string,
  ): Promise<DiffEntry> {
    let local = ""
    let incoming = ""
    let truncated = false
    let error: string | null = null
    try {
      local = await runGitDiff(repoPath, ["HEAD", "--", file])
      incoming = await runGitDiff(repoPath, ["HEAD", target, "--", file])
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
    if (local.length > MAX_DIFF_BYTES) {
      local = local.slice(0, MAX_DIFF_BYTES) + "\n… [truncated]"
      truncated = true
    }
    if (incoming.length > MAX_DIFF_BYTES) {
      incoming = incoming.slice(0, MAX_DIFF_BYTES) + "\n… [truncated]"
      truncated = true
    }
    return { path: file, local, incoming, truncated, error }
  }
}

/** `git diff` exits non-zero only on real errors — a non-empty
 * diff is exit 0. We ask for `--no-color` so the prompt is plain
 * text the agent can apply without ANSI noise. */
async function runGitDiff(repoPath: string, rest: string[]): Promise<string> {
  try {
    const { stdout } = await execFileP(
      "git",
      ["-C", repoPath, "diff", "--no-color", ...rest],
      { maxBuffer: 4 * 1024 * 1024 },
    )
    return stdout
  } catch (err) {
    // `git diff` against an unknown ref (target not fetched yet)
    // throws — surface it as an empty diff with an error so the
    // renderer can still ship the other half.
    if (err instanceof Error) throw new Error(err.message)
    throw err
  }
}
