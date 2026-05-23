import { useCallback, type MouseEvent } from "react"
import { useRpc } from "@zenbujs/core/react"

export type PrOpenMode = "new-tab" | "split-right" | "replace"

/**
 * Browser-style modifier → openMode mapping for a mouse event.
 *
 * The defaults mirror what we picked for the PR view's forward
 * navigation today, but the function is intentionally generic — any
 * future view can lift it into a shared `lib/` and follow the same
 * conventions.
 *
 *   - plain click     → caller's `defaultMode` (forward nav usually
 *                       wants `"new-tab"`; row clicks within a list
 *                       usually want `"replace"`).
 *   - shift-click     → `"split-right"`   (open alongside).
 *   - cmd / middle    → `"new-tab"`       (browser-standard).
 *   - alt-click       → `"replace"`       (escape hatch for callers
 *                                          whose default is new-tab).
 */
export function modifierOpenMode(
  e: MouseEvent | null,
  defaultMode: PrOpenMode = "new-tab",
): PrOpenMode {
  if (!e) return defaultMode
  if (e.shiftKey) return "split-right"
  if (e.altKey) return "replace"
  if (e.metaKey || e.ctrlKey || e.button === 1) return "new-tab"
  return defaultMode
}

/**
 * Hook that turns a button/row click into an `openPullRequestsView`
 * RPC call. Centralising the call here gives every entry-point the
 * same prefetch path (the service warms its in-memory cache before
 * the iframe mounts) and the same panel-event vocabulary
 * (`new-tab` / `split-right` / `replace`) so view authors don't
 * have to think about how the pane tree handles it.
 *
 * Pass `directory` from a parent that already resolved it from
 * `useViewArgs()` / window-state fallback so we don't redo that
 * lookup per click.
 */
export function useOpenPrView(directory: string | null) {
  const rpc = useRpc()
  return useCallback(
    (args: {
      mode: "create" | "list" | "detail"
      prNumber?: number | null
      openMode?: PrOpenMode
    }) => {
      void rpc.app.github.openPullRequestsView({
        mode: args.mode,
        prNumber: args.prNumber ?? null,
        directory,
        openMode: args.openMode ?? "new-tab",
      })
    },
    [directory, rpc],
  )
}
