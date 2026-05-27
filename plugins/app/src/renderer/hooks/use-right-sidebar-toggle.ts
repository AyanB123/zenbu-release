import { useCallback, useEffect } from "react"
import { useEvents } from "@zenbujs/core/react"
import { useSidebarViews } from "@/lib/sidebar-views"
import { useRightSidebarLastType, useRightSidebarOpenType, useSetRightSidebarOpenType } from "@/lib/window-state/scope-ui"
import { useWorkspaceLayout } from "@/lib/window-state/layout"
export const DEFAULT_RIGHT_SIDEBAR_WIDTH = 320
export const SNAP_RIGHT_SIDEBAR_WIDTH = 160

export type RightSidebarState = ReturnType<typeof useRightSidebarToggle>

/** Right-sidebar visibility, view selection, and ⌘G shortcut. */
export function useRightSidebarToggle() {
  const sidebarViews = useSidebarViews()
  const rightOpenType = useRightSidebarOpenType()
  // Remember the last view the user picked so close+reopen restores
  // it instead of always landing on the first registered view.
  const lastRightType = useRightSidebarLastType()
  const setRightOpenType = useSetRightSidebarOpenType()
  const workspaceLayout = useWorkspaceLayout()
  const rightSidebarWidth =
    workspaceLayout.rightSidebarWidth ?? DEFAULT_RIGHT_SIDEBAR_WIDTH
  const isRightBodyOpen = rightOpenType != null && sidebarViews.length > 0

  const onRightSelectType = useCallback(
    (type: string) => {
      setRightOpenType(type)
    },
    [setRightOpenType],
  )

  const onRightToggle = useCallback(() => {
    if (rightOpenType != null) {
      setRightOpenType(null)
      return
    }
    if (sidebarViews.length === 0) return
    const restore =
      (lastRightType && sidebarViews.some(v => v.type === lastRightType)
        ? lastRightType
        : null) ?? sidebarViews[0]?.type ?? null
    if (restore) {
      setRightOpenType(restore)
    }
  }, [rightOpenType, sidebarViews, lastRightType, setRightOpenType])

  // ⌘/Ctrl+G toggles the right sidebar, mirroring ⌘/Ctrl+B for the left.
  //
  // Goes through the core ShortcutsService (declared in
  // `ShortcutsService_App`) rather than a raw window `keydown`
  // listener so the shortcut-bridge prelude can `preventDefault` +
  // `stopPropagation` the keystroke synchronously in the capture
  // phase. Without that, the same `g` keystroke leaks down to any
  // bubble-phase listener attached lower in the DOM (e.g. the
  // terminal view's ghostty contenteditable), which would write a
  // literal 'g' into the pty before our handler ran. Subscribing to
  // the dispatched event keeps the binding configurable via the
  // Shortcuts settings UI as a bonus.
  const events = useEvents()
  useEffect(() => {
    const off = events.app.toggleRightSidebar.subscribe(() => {
      onRightToggle()
    })
    return off
  }, [events, onRightToggle])

  // If the previously-open type was unregistered (e.g. the plugin
  // contributing it was removed), close the sidebar.
  useEffect(() => {
    if (!rightOpenType) return
    if (!sidebarViews.some(v => v.type === rightOpenType)) {
      setRightOpenType(null)
    }
  }, [sidebarViews, rightOpenType, setRightOpenType])

  return {
    sidebarViews,
    rightOpenType,
    rightSidebarWidth,
    isRightBodyOpen,
    onRightSelectType,
    onRightToggle,
  }
}
