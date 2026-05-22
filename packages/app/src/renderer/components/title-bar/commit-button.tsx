import { useCallback, useEffect, useRef, useState } from "react"
import { useRpc } from "@zenbujs/core/react"
import { GitCommitVerticalIcon } from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { CommitPopoverBody } from "./commit-popover-body"

const POLL_MS = 3000

type LastCommit = {
  hash: string
  shortHash: string
  subject: string
  author: string
  relativeDate: string
} | null

export type Summary = {
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

export type CommitButtonProps = {
  directory: string | null
}

/**
 * Title-bar button that shows the working-tree diff size as `+a -d`
 * and opens a roomy commit/status popover on click.
 *
 * Polls the main process every few seconds while idle — git status
 * is cheap. While the popover is open we also let the popover drive
 * refresh after mutating actions (commit/pull/push/fetch).
 */
export function CommitButton({ directory }: CommitButtonProps) {
  const rpc = useRpc()
  const [summary, setSummary] = useState<Summary | null>(null)
  const [open, setOpen] = useState(false)
  const inFlight = useRef(false)

  const refresh = useCallback(async () => {
    if (!directory) {
      setSummary(null)
      return
    }
    if (inFlight.current) return
    inFlight.current = true
    try {
      const s = await rpc.app.git.getStatusSummary({ directory })
      if (!s.ok || !s.isRepo) {
        setSummary(null)
      } else {
        setSummary({
          additions: s.additions,
          deletions: s.deletions,
          changed: s.changed,
          untracked: s.untracked,
          branch: s.branch,
          upstream: s.upstream,
          ahead: s.ahead,
          behind: s.behind,
          lastCommit: s.lastCommit,
        })
      }
    } catch {
      setSummary(null)
    } finally {
      inFlight.current = false
    }
  }, [directory, rpc])

  useEffect(() => {
    void refresh()
    const id = setInterval(() => {
      void refresh()
    }, POLL_MS)
    return () => clearInterval(id)
  }, [refresh])

  if (!directory) return null

  const additions = summary?.additions ?? 0
  const deletions = summary?.deletions ?? 0
  const untracked = summary?.untracked ?? 0
  const dirty =
    (summary?.changed ?? 0) > 0 ||
    untracked > 0 ||
    additions > 0 ||
    deletions > 0

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={
            summary
              ? `${summary.branch ?? "detached"} — ${summary.changed} changed${
                  untracked ? `, ${untracked} untracked` : ""
                }`
              : "Commit"
          }
          className={
            "group inline-flex h-[22px] items-center gap-1.5 rounded-md border border-transparent " +
            "px-1.5 text-[11px] font-medium leading-none transition-colors " +
            "hover:border-border hover:bg-background/60 " +
            "data-[state=open]:border-border data-[state=open]:bg-background/60 " +
            (dirty ? "text-foreground" : "text-muted-foreground")
          }
        >
          <GitCommitVerticalIcon className="h-3.5 w-3.5 opacity-80" />
          {dirty ? (
            <span className="flex items-center gap-1 tabular-nums">
              <span className="text-emerald-500 dark:text-emerald-400">
                +{additions}
              </span>
              <span className="text-rose-500 dark:text-rose-400">
                −{deletions}
              </span>
              {untracked > 0 && (
                <span className="text-muted-foreground">·{untracked}</span>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground">clean</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-[460px] p-0"
      >
        <CommitPopoverBody
          directory={directory}
          open={open}
          summary={summary}
          onRefreshSummary={refresh}
          onClose={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  )
}
