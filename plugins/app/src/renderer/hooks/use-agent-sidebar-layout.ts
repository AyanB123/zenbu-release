import { useEffect, useLayoutEffect, useRef } from "react"
import { useEvents } from "@zenbujs/core/react"
import type { AllotmentHandle } from "allotment"
import { useActiveScopeId, useActiveWorkspaceId } from "@/lib/window-state/active-view"
import { useBottomPanelOpen, useSetBottomPanelOpen } from "@/lib/window-state/scope-ui"
export type AgentSidebarLayout = ReturnType<typeof useAgentSidebarLayout>

export type UseAgentSidebarLayoutArgs = {
  /** Whether the right body pane is currently mounted. Drives the
   * inner-Allotment re-resize effect when it appears/disappears. */
  isRightBodyOpen: boolean
  sidebarOpen: boolean
  sidebarWidth: number
  rightSidebarWidth: number
  terminalHeight: number
  /** Whether the 3-Allotment shell is mounted at all. Resets totals
   * to zero on unmount so a remount uses `preferredSize` on first
   * paint instead of stale measurements. */
  allotmentsMounted: boolean
}

/** Owns the three Allotment handles and the imperative resize logic
 * that keeps sash positions correct across workspace/scope switches
 * and right-sidebar mount toggles.
 *
 * Allotment ignores `preferredSize` prop updates on already-mounted
 * views, so we drive sash positions imperatively here. */
export function useAgentSidebarLayout({
  isRightBodyOpen,
  sidebarOpen,
  sidebarWidth,
  rightSidebarWidth,
  terminalHeight,
  allotmentsMounted,
}: UseAgentSidebarLayoutArgs) {
  const events = useEvents()
  const activeWorkspaceId = useActiveWorkspaceId()
  const activeScopeId = useActiveScopeId()
  const terminalOpen = useBottomPanelOpen()
  const setTerminalOpen = useSetBottomPanelOpen()

  const outerAllotmentRef = useRef<AllotmentHandle>(null)
  const verticalAllotmentRef = useRef<AllotmentHandle>(null)
  const innerAllotmentRef = useRef<AllotmentHandle>(null)

  // Latest total dimensions captured from each Allotment's
  // `onChange`. Needed because imperative `resize(...)` takes
  // absolute sizes for every pane.
  const outerTotalWidthRef = useRef(0)
  const verticalTotalHeightRef = useRef(0)
  const innerTotalWidthRef = useRef(0)

  // Reset totals when the shell is unmounted (onboarding view, or
  // zero workspaces). Without this, a remount sees stale `total > 0`
  // and crashes inside Splitview.resizeViews against an Allotment
  // whose view bookkeeping hasn't reconciled yet.
  useLayoutEffect(() => {
    if (allotmentsMounted) return
    outerTotalWidthRef.current = 0
    verticalTotalHeightRef.current = 0
    innerTotalWidthRef.current = 0
  }, [allotmentsMounted])

  // When the right body pane appears/disappears, Allotment internally
  // calls `addView(Sizing.Distribute)` which equalises every pane.
  // Re-apply the desired layout before paint.
  useLayoutEffect(() => {
    const handle = innerAllotmentRef.current
    const total = innerTotalWidthRef.current
    if (!handle || total <= 0) return
    if (isRightBodyOpen) {
      const right = rightSidebarWidth
      const content = Math.max(0, total - right)
      handle.resize([content, right])
    } else {
      handle.resize([total])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRightBodyOpen])

  // Workspace OR scope switch: imperatively move every shell sash
  // to the new identity's saved position. `preferredSize` prop
  // updates alone don't move anything; we drive sash positions
  // through `ref.current.resize(...)` here.
  //
  // We deliberately use `onDragEnd` (not `onChange`) below to persist
  // sizes: the imperative resize calls in this effect would otherwise
  // re-enter our own write path with the OLD render's `onChange`
  // closure. `onDragEnd` only fires on real user drags.
  const prevWorkspaceRef = useRef(activeWorkspaceId)
  const prevScopeRef = useRef(activeScopeId)
  useLayoutEffect(() => {
    const workspaceChanged = prevWorkspaceRef.current !== activeWorkspaceId
    const scopeChanged = prevScopeRef.current !== activeScopeId
    if (!workspaceChanged && !scopeChanged) return
    prevWorkspaceRef.current = activeWorkspaceId
    prevScopeRef.current = activeScopeId

    if (workspaceChanged) {
      const outerTotal = outerTotalWidthRef.current
      if (outerTotal > 0 && sidebarOpen) {
        outerAllotmentRef.current?.resize([
          sidebarWidth,
          Math.max(0, outerTotal - sidebarWidth),
        ])
      }
    }
    if (workspaceChanged || scopeChanged) {
      const verticalTotal = verticalTotalHeightRef.current
      if (verticalTotal > 0 && terminalOpen) {
        verticalAllotmentRef.current?.resize([
          Math.max(0, verticalTotal - terminalHeight),
          terminalHeight,
        ])
      }
      const innerTotal = innerTotalWidthRef.current
      if (innerTotal > 0 && isRightBodyOpen) {
        innerAllotmentRef.current?.resize([
          Math.max(0, innerTotal - rightSidebarWidth),
          rightSidebarWidth,
        ])
      }
    }
  }, [
    activeWorkspaceId,
    activeScopeId,
    sidebarOpen,
    terminalOpen,
    isRightBodyOpen,
    sidebarWidth,
    rightSidebarWidth,
    terminalHeight,
  ])

  useEffect(() => {
    const off = events.app.toggleTerminal.subscribe(() => {
      setTerminalOpen(o => !o)
    })
    return off
  }, [events, setTerminalOpen])

  // Focus management when the bottom panel opens/closes lives in
  // `BottomPanel` itself — it owns its own container ref and is
  // generic over view type, so any registered bottom-panel view
  // gets the same focus behaviour without the shell needing to
  // know about it.

  return {
    outerAllotmentRef,
    verticalAllotmentRef,
    innerAllotmentRef,
    outerTotalWidthRef,
    verticalTotalHeightRef,
    innerTotalWidthRef,
  }
}
