import { useEffect, useState } from "react"
import { useRpc, type ViewComponentProps } from "@zenbujs/core/react"
import { DiffViewer } from "@/views/pr/components/diff-viewer"
import { FilePreview } from "@/views/file-tree/file-preview"
import type { GitFileStatus, GitStatus } from "@/views/pr/types"

type GitDiffArgs = {
  directory?: string
  path?: string
}

const POLL_MS = 2500

/**
 * Embed view (component-mode) that renders a diff for a single
 * file. Receives `{ directory, path }` via the host-passed `args`
 * prop (set by the main shell when it catches
 * `openDiffInActivePane`), then polls live `pr.getStatus` to find
 * the matching `GitFileStatus` so the existing `<DiffViewer>` (same
 * one the full Git view uses) can render the actual diff.
 *
 * Polled on the same cadence as `git-client.tsx`; falls back to a
 * read-only `<FilePreview>` if the file leaves the worktree
 * (committed, discarded, etc).
 */
export default function GitDiffView({
  args,
}: ViewComponentProps<GitDiffArgs>) {
  const directory = args?.directory ?? null
  const path = args?.path ?? null

  if (!directory || !path) {
    return <Placeholder>Missing directory or path argument.</Placeholder>
  }

  return (
    <GitDiffPane key={`${directory}::${path}`} directory={directory} path={path} />
  )
}

function GitDiffPane({ directory, path }: { directory: string; path: string }) {
  const file = usePolledFile(directory, path)

  if (file === undefined) {
    // Blank during the first status fetch — a spinner/text just
    // makes the inevitable swap to the real diff feel flashier.
    return null
  }
  if (file === null) {
    // No git diff for this path (file is clean, was just committed, or
    // simply isn't tracked as changed). Fall back to a plain read-only
    // view of the file's current contents so the pane is still useful.
    return (
      <div className="relative flex h-full min-h-0 w-full flex-col bg-background">
        <div className="flex h-7 shrink-0 items-center gap-2 border-b bg-background px-3 text-[11.5px] text-muted-foreground">
          <span className="truncate font-mono">{path}</span>
          <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px]">
            no changes
          </span>
        </div>
        <div className="min-h-0 flex-1">
          <FilePreview directory={directory} path={path} />
        </div>
      </div>
    )
  }

  // Match the heuristic the changes-tab uses: when a file is staged
  // and has no unstaged half, show the staged diff; otherwise show
  // the working-tree diff.
  const staged = file.staged && !file.unstaged
  return (
    <div className="relative h-full min-h-0 w-full bg-background">
      <DiffViewer directory={directory} file={file} staged={staged} />
    </div>
  )
}

/* -------------------------------- helpers ------------------------------- */

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center bg-background p-4 text-center text-[12px] text-muted-foreground">
      {children}
    </div>
  )
}

/** Poll `pr.getStatus` and pick out the entry for `path`. Returns:
 *
 *   - `undefined` while the first status response is in flight
 *   - `null` when status has loaded but `path` isn't in it
 *   - the matching `GitFileStatus` otherwise */
function usePolledFile(
  directory: string,
  path: string,
): GitFileStatus | null | undefined {
  const rpc = useRpc()
  const [status, setStatus] = useState<GitStatus | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const next = await rpc.app.pr.getStatus({ directory })
        if (!cancelled) setStatus(next)
      } catch {
        // Errors are visible in the full Git view; the diff pane just
        // sticks with the last good snapshot.
      }
    }
    void tick()
    const id = setInterval(() => void tick(), POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [directory, rpc])

  if (status === undefined) return undefined
  if (!status) return null
  return status.files.find(f => f.path === path) ?? null
}
