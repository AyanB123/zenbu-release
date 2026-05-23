import { useEffect, useState } from "react"
import { useDb, useViewArgs } from "@zenbujs/core/react"
import { useThemeSync } from "@/lib/theme"
import { CreatePrPane } from "./components/create-pr-pane"
import { PrListPane } from "./components/pr-list-pane"
import { PrDetailPane } from "./components/pr-detail-pane"
import type { PullRequestsViewArgs, PullRequestsViewMode } from "./types"

/**
 * Entry component for the "Pull Requests" view. Acts like a small
 * three-page router whose initial page is driven by the view args
 * (`mode` + optional `prNumber`):
 *
 *   - `create` — the default. Renders the new-PR composer for the
 *     active scope's current branch.
 *   - `list`   — paginated `gh pr list` view.
 *   - `detail` — a single PR's `gh pr view` payload with diff.
 *
 * The mode is stored in local state so navigating from list → detail
 * → back doesn't require closing/reopening the tab. Args are still
 * the source of truth for the *initial* mount, which means the
 * command palette can deep-link to any page via the existing
 * `openViewBySourceInRoot` helper.
 */
export function PullRequestsApp() {
  useThemeSync()
  const args = useViewArgs<PullRequestsViewArgs>() ?? {}
  const argDirectory = args.directory ?? null
  const fallbackDirectory = useFallbackScopeDirectory(argDirectory == null)
  const directory = argDirectory ?? fallbackDirectory

  const initialMode: PullRequestsViewMode = args.mode ?? "create"
  const [mode, setMode] = useState<PullRequestsViewMode>(initialMode)
  const [prNumber, setPrNumber] = useState<number | null>(args.prNumber ?? null)

  // If the host re-mounts us with new args (e.g. another
  // `openPullRequestsView` event fires from a different command),
  // follow them.
  useEffect(() => {
    if (args.mode) setMode(args.mode)
    if (args.prNumber != null) setPrNumber(args.prNumber)
  }, [args.mode, args.prNumber])

  // Navigation model inside this view, modelled after browser links:
  //
  //   - Forward navigation ("Open PRs" button, PR row click in the
  //     list) goes through the service's `openPullRequestsView`
  //     RPC, which emits the panel event and lets the host place
  //     the destination in a new tab / split / replace. Each
  //     forward-nav button picks its own *default* openMode and
  //     `modifierOpenMode()` (see `lib/use-open-pr-view.ts`)
  //     translates Cmd / Shift / middle-click / Alt into overrides.
  //     These call sites live inside the leaf panes themselves —
  //     no wiring here.
  //
  //   - Backward navigation ("← New PR", "← All PRs") is a local
  //     state swap. It feels like a browser back and never spawns
  //     a new tab — the user is returning to a page they came
  //     from, not creating a new context.
  const goBack = (next: PullRequestsViewMode) => setMode(next)

  if (!directory) {
    return (
      <div className="flex h-full items-center justify-center bg-background p-4 text-center text-[12px] text-muted-foreground">
        No active workspace.
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      {mode === "create" && (
        <CreatePrPane key={directory} directory={directory} />
      )}
      {mode === "list" && (
        <PrListPane
          key={directory}
          directory={directory}
          onBack={() => goBack("create")}
        />
      )}
      {mode === "detail" && prNumber != null && (
        <PrDetailPane
          key={`${directory}:${prNumber}`}
          directory={directory}
          prNumber={prNumber}
          onBack={() => goBack("list")}
        />
      )}
      {mode === "detail" && prNumber == null && (
        <div className="flex h-full items-center justify-center p-4 text-[12px] text-muted-foreground">
          No PR selected.
        </div>
      )}
    </div>
  )
}

/** Last-resort directory resolver. Same pattern as the Git view. */
function useFallbackScopeDirectory(enabled: boolean): string | null {
  return useDb(root => {
    if (!enabled) return null
    const states = Object.values(root.app.windowStates)
    const scopeId =
      states.find(s => s.selectedScopeId != null)?.selectedScopeId ?? null
    if (!scopeId) return null
    return root.app.scopes[scopeId]?.directory ?? null
  })
}
