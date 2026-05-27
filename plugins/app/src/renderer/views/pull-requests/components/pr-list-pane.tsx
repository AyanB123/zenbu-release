import { useCallback, useEffect, useState } from "react"
import { useRpc } from "@zenbujs/core/react"
import { Button } from "@zenbu/ui/button"
import { Spinner } from "@zenbu/ui/spinner"
import { cn } from "@/lib/utils"
import { ErrorBanner } from "./error-banner"
import { modifierOpenMode, useOpenPrView } from "../lib/use-open-pr-view"
import type { PrSummary } from "../types"

type StateFilter = "open" | "closed" | "merged" | "all"

const FILTERS: { value: StateFilter; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "merged", label: "Merged" },
  { value: "all", label: "All" },
]

/**
 * GitHub-style PR list. Top filter row maps directly to the `state`
 * arg of `gh pr list`. Each row is a single click → detail view.
 *
 * Kept deliberately small — the renderer doesn't paginate; we cap
 * at 50 PRs per state via the service, which is plenty for the
 * "what's open right now" use case this panel is designed for.
 */
export function PrListPane({
  directory,
  onBack,
}: {
  directory: string
  /** Back to the composer. Always handled by parent local state
   * so it feels like browser back — no fresh tab. */
  onBack: () => void
}) {
  const rpc = useRpc()
  // Row clicks are *intra-list* navigation — the user is browsing
  // PRs and expects the detail to swap in place (replace), just
  // like clicking a row in any list app. Modifier keys still let
  // them pop the detail into a new tab / split if they want.
  const openPrView = useOpenPrView(directory)
  const [state, setState] = useState<StateFilter>("open")
  const [prs, setPrs] = useState<PrSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const res = await rpc.app.github.listPullRequests({
      directory,
      state,
      limit: 50,
    })
    setLoading(false)
    if (res.ok) {
      setPrs(res.prs)
    } else {
      setPrs([])
      setError(res.error)
    }
  }, [directory, rpc, state])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 overflow-hidden border-b px-3 text-[12px]">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="h-6 shrink-0 px-1.5 text-[11px]"
        >
          ← New PR
        </Button>
        <div className="ml-1 flex shrink-0 items-center gap-1">
          {FILTERS.map(f => (
            <button
              key={f.value}
              type="button"
              onClick={() => setState(f.value)}
              className={cn(
                "rounded px-1.5 py-0.5 text-[11px] transition-colors",
                state === f.value
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/40",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void load()}
          className="ml-auto h-6 shrink-0 px-1.5 text-[11px]"
        >
          {loading ? <Spinner size={12} /> : "Refresh"}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {error && (
          <div className="p-3">
            <ErrorBanner title="Could not load pull requests" detail={error} />
          </div>
        )}
        {!error && prs == null && (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Spinner size={16} />
          </div>
        )}
        {prs && prs.length === 0 && !error && (
          <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
            No {state} pull requests.
          </div>
        )}
        {prs && prs.length > 0 && (
          // `divide-y` puts separators *between* rows but never
          // after the last one (no orphan border floating in empty
          // space). Explicit `divide-border` so the divider always
          // resolves through the shared `--color-border` token —
          // some surfaces I was getting reports of "no border between
          // items", which turned out to be the base-layer fallback
          // losing to a Tailwind utility on certain children;
          // pinning the divide color makes that impossible.
          <ul className="divide-y divide-border">
            {prs.map(pr => (
              <li key={pr.number}>
                <button
                  type="button"
                  aria-label="Open · ⌘/middle: new tab · Shift: split"
                  // Plain click replaces in-place (in-list
                  // navigation). Cmd/middle-click → new tab,
                  // Shift → split.
                  onClick={e =>
                    openPrView({
                      mode: "detail",
                      prNumber: pr.number,
                      openMode: modifierOpenMode(e, "replace"),
                    })
                  }
                  // Middle-click doesn't fire a regular `click` on a
                  // <button>; `onAuxClick` does, and we send the
                  // same event through the same modifier mapper.
                  onAuxClick={e => {
                    if (e.button !== 1) return
                    e.preventDefault()
                    openPrView({
                      mode: "detail",
                      prNumber: pr.number,
                      openMode: "new-tab",
                    })
                  }}
                  // py-3.5 + a slightly stronger hover background
                  // make each row read as a distinct hit target;
                  // with just 1px of subtle divide and py-3 it was
                  // easy for adjacent rows to visually blend.
                  className="flex w-full flex-col gap-1 px-4 py-3.5 text-left transition-colors hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:outline-none"
                >
                  <div className="flex items-baseline gap-2">
                    <StateBadge state={pr.state} isDraft={pr.isDraft} />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                      {pr.title}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      #{pr.number}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span>{pr.headRefName}</span>
                    <span>→</span>
                    <span>{pr.baseRefName}</span>
                    <span>·</span>
                    <span>by {pr.author}</span>
                    <span>·</span>
                    <span>{formatRelative(pr.updatedAt)}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function StateBadge({
  state,
  isDraft,
}: {
  state: PrSummary["state"]
  isDraft: boolean
}) {
  let label: string = state
  let cls = "bg-muted text-muted-foreground"
  if (isDraft) {
    label = "DRAFT"
    cls = "bg-muted text-muted-foreground"
  } else if (state === "OPEN") {
    cls = "bg-green-500/15 text-green-600 dark:text-green-400"
  } else if (state === "MERGED") {
    cls = "bg-purple-500/15 text-purple-600 dark:text-purple-400"
  } else if (state === "CLOSED") {
    cls = "bg-red-500/15 text-red-600 dark:text-red-400"
  }
  return (
    <span
      className={cn(
        "shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase",
        cls,
      )}
    >
      {label}
    </span>
  )
}

function formatRelative(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ""
  const diff = (Date.now() - t) / 1000
  if (diff < 60) return "just now"
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`
  return new Date(t).toLocaleDateString()
}
