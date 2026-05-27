import { useMemo, type ReactNode } from "react"
import { Allotment, LayoutPriority } from "allotment"
import { View } from "@zenbujs/core/react"
import { PaneFrame } from "../layout/pane-frame"
import { ErrorBoundary } from "../common/error-boundary"
import { EmptyWorkspaceScreen } from "../empty-workspace-screen"
import { useActiveView } from "@/lib/window-state/active-view"
import { useLeftSidebarOpen, useSetLeftSidebarOpen } from "@/lib/window-state/workspace-ui"
import { useBottomPanelOpen, useBottomPanelView, useSetBottomPanelOpen, useSetBottomPanelView, useSetRightSidebarOpenType } from "@/lib/window-state/scope-ui"
import { useSetWorkspaceLayout, useWorkspaceLayout } from "@/lib/window-state/layout"
import { useBottomPanelViews } from "@/lib/bottom-panel-views"
import {
  useRightSidebarToggle,
  DEFAULT_RIGHT_SIDEBAR_WIDTH,
  SNAP_RIGHT_SIDEBAR_WIDTH,
} from "../../hooks/use-right-sidebar-toggle"
import { useAgentSidebarLayout } from "../../hooks/use-agent-sidebar-layout"
import {
  useActiveScope,
  useHasAnyWorkspace,
} from "../../hooks/use-sidebar-selectors"
import { ChatsArea } from "./chats-area"
import { RightSidebar } from "./right-sidebar/right-sidebar"
import { BottomPanel } from "./bottom-panel/bottom-panel"
import { useWindowId } from "@/lib/window-state/window-id"
const DEFAULT_SIDEBAR_WIDTH = 220
const SNAP_SIDEBAR_WIDTH = 160
const DEFAULT_TERMINAL_HEIGHT = 260
const SNAP_TERMINAL_HEIGHT = 80

export type WorkspaceBodyProps = {
  /** The left sidebar contents, passed as a slot so the layout
   * doesn't need to know about chat data. */
  sidebarSlot: ReactNode
}

/** The 3-Allotment workspace layout: outer (sidebar | rest),
 * vertical (content+right | bottom panel), inner (content | right
 * sidebar). The central slot is always `<ChatsArea>`. */
export function WorkspaceBody({ sidebarSlot }: WorkspaceBodyProps) {
  const activeView = useActiveView()
  const hasAnyWorkspace = useHasAnyWorkspace()

  if (activeView.kind === "view") {
    // settings/onboarding screen, when the workspace is not rendering
    return (
      <div className="absolute inset-0">
        <PaneFrame rightAdjacent className="overflow-hidden">
          <View
            type={activeView.viewType}
            args={activeView.args}
            className="size-full"
            fallback={
              <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">
              </div>
            }
          />
        </PaneFrame>
      </div>
    )
  }

  const showOnboardingOverlay =
    !hasAnyWorkspace || activeView.kind === "onboarding"

  // Mount the workspace shell unconditionally and overlay the
  // onboarding screen on top while we're in onboarding (or have no
  // workspaces yet). The point is to pre-warm Allotment: it relies
  // on a ResizeObserver to compute pane widths, so the very first
  // paint after a fresh mount lays out at 0px until the observer
  // fires one tick later. Mounting the shell behind the
  // onboarding screen means the panes are measured and at their
  // saved widths by the time the overlay drops — "create project"
  // resolves into the fully-laid-out workspace with no
  // sidebar-pops-out / chat-pops-in torn frames in between.
  //
  // `WorkspaceBodyAllotments` already handles a null scope (its
  // hooks return empty data and `ChatsArea` falls back to an
  // empty `<ChatPane chat={null} />`), so rendering it pre-workspace
  // is safe.
  return (
    <div
      className="relative h-full w-full"
      // Electron's drag-region resolution is geometric and does
      // NOT inherit `-webkit-app-region` through the DOM the way
      // normal CSS would. Without explicit `no-drag` on each layer
      // we render here, Chromium happily reports the overlay's
      // bounding rect as part of the outer shell's `drag` claim
      // — every click on the onboarding screen turns into a
      // window-move and nothing is reachable. Re-asserting
      // `no-drag` at this level (and on each child below) is what
      // the rest of the title bar / sidebar code does for the
      // same reason; it's not a CSS inheritance escape, it's how
      // Electron actually wants drag regions declared.
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      <div
        className="absolute inset-0"
        // While the onboarding overlay is up, hide the pre-warmed
        // shell with `visibility: hidden` rather than unmounting
        // it. Two properties matter here, neither of which we
        // get from `display: none` or from a high-z overlay:
        //   1. The Allotment containers still occupy layout, so
        //      `ResizeObserver` measures them and pane widths
        //      land at their saved values — the whole reason we
        //      pre-mount in the first place.
        //   2. A `visibility: hidden` subtree is taken out of
        //      hit-testing entirely, so the sashes / drag handles
        //      inside the shell can't swallow clicks.
        // Drag regions, on the other hand, are still reported to
        // Electron from visibility:hidden subtrees, so we still
        // need explicit `no-drag` here too.
        style={
          showOnboardingOverlay
            ? {
                visibility: "hidden",
                WebkitAppRegion: "no-drag",
              }
            : ({ WebkitAppRegion: "no-drag" } as React.CSSProperties)
        }
        aria-hidden={showOnboardingOverlay || undefined}
      >
        <WorkspaceBodyAllotments sidebarSlot={sidebarSlot} />
      </div>
      {showOnboardingOverlay && (
        <div
          // Sibling overlay (not z-stacked above the shell with a
          // large z-index) because the shell underneath is
          // visibility:hidden and so doesn't render any of its
          // own pixels here. `bg-muted` matches the outer app
          // shell so the very first commit doesn't flash a
          // 1-frame gap before the EmptyWorkspaceScreen's own
          // `bg-background` paints over.
          className="absolute inset-0 bg-muted"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <EmptyWorkspaceScreen />
        </div>
      )}
    </div>
  )
}

function WorkspaceBodyAllotments({ sidebarSlot }: WorkspaceBodyProps) {
  const windowId = useWindowId()
  const sidebarOpen = useLeftSidebarOpen()
  const setSidebarOpen = useSetLeftSidebarOpen()
  const terminalOpen = useBottomPanelOpen()
  const setTerminalOpen = useSetBottomPanelOpen()
  const workspaceLayout = useWorkspaceLayout()
  const setWorkspaceLayout = useSetWorkspaceLayout()
  const sidebarWidth = workspaceLayout.sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH
  const terminalHeight =
    workspaceLayout.terminalHeight ?? DEFAULT_TERMINAL_HEIGHT

  const bottomPanelViews = useBottomPanelViews()
  const persistedBottomPanelView = useBottomPanelView()
  const setBottomPanelView = useSetBottomPanelView()
  const setRightOpenType = useSetRightSidebarOpenType()

  const activeScope = useActiveScope()

  const {
    sidebarViews,
    rightOpenType,
    rightSidebarWidth,
    isRightBodyOpen,
    onRightSelectType,
  } = useRightSidebarToggle()

  // Resolve the active bottom-panel view: persisted choice when
  // still registered, otherwise the first available.
  const activeBottomPanelView = useMemo(() => {
    if (
      persistedBottomPanelView &&
      bottomPanelViews.some(v => v.type === persistedBottomPanelView)
    ) {
      return persistedBottomPanelView
    }
    return bottomPanelViews[0]?.type ?? null
  }, [bottomPanelViews, persistedBottomPanelView])

  const {
    outerAllotmentRef,
    verticalAllotmentRef,
    innerAllotmentRef,
    outerTotalWidthRef,
    verticalTotalHeightRef,
    innerTotalWidthRef,
  } = useAgentSidebarLayout({
    isRightBodyOpen,
    sidebarOpen,
    sidebarWidth,
    rightSidebarWidth: rightSidebarWidth ?? DEFAULT_RIGHT_SIDEBAR_WIDTH,
    terminalHeight,
    allotmentsMounted: true,
  })

  return (
    <Allotment
      ref={outerAllotmentRef}
      // The 12px separator inset in main.css is scoped to this
      // class so it only applies here (where the separator meets
      // the window's rounded outer corner) and not to nested
      // Allotments.
      className="app-shell-allotment"
      proportionalLayout={false}
      onChange={sizes => {
        // Persist on `onDragEnd`, not here — the imperative resize
        // calls in useAgentSidebarLayout would otherwise re-enter
        // our own write path with stale closures.
        outerTotalWidthRef.current = sizes.reduce((a, b) => a + b, 0)
      }}
      onDragEnd={sizes => {
        const [left] = sizes
        if (sidebarOpen && left > 0) {
          setWorkspaceLayout({ sidebarWidth: left })
        }
      }}
      onVisibleChange={(index, visible) => {
        if (index === 0 && !visible) setSidebarOpen(false)
      }}
    >
      <Allotment.Pane
        visible={sidebarOpen}
        minSize={SNAP_SIDEBAR_WIDTH}
        preferredSize={sidebarWidth}
        priority={LayoutPriority.Low}
        snap
      >
        {sidebarSlot}
      </Allotment.Pane>

      <Allotment.Pane priority={LayoutPriority.High}>
        <Allotment
          ref={verticalAllotmentRef}
          vertical
          proportionalLayout={false}
          onChange={sizes => {
            verticalTotalHeightRef.current = sizes.reduce(
              (a, b) => a + b,
              0,
            )
          }}
          onDragEnd={sizes => {
            const bottom = sizes[1]
            if (terminalOpen && bottom != null && bottom > 0) {
              setWorkspaceLayout({ terminalHeight: bottom })
            }
          }}
          onVisibleChange={(index, visible) => {
            if (index === 1 && !visible) setTerminalOpen(false)
          }}
        >
          <Allotment.Pane priority={LayoutPriority.High}>
            <Allotment
              ref={innerAllotmentRef}
              proportionalLayout={false}
              onChange={sizes => {
                innerTotalWidthRef.current = sizes.reduce(
                  (a, b) => a + b,
                  0,
                )
              }}
              onDragEnd={sizes => {
                const right = sizes[1]
                if (isRightBodyOpen && right != null && right > 0) {
                  setWorkspaceLayout({ rightSidebarWidth: right })
                }
              }}
              onVisibleChange={(index, visible) => {
                if (index === 1 && !visible) setRightOpenType(null)
              }}
            >
              <Allotment.Pane priority={LayoutPriority.High}>
                <ChatsArea
                  leftAdjacent={sidebarOpen}
                  bottomAdjacent={terminalOpen}
                  rightAdjacent={isRightBodyOpen}
                />
              </Allotment.Pane>

              {isRightBodyOpen && rightOpenType != null && (
                <Allotment.Pane
                  key="right-body"
                  minSize={SNAP_RIGHT_SIDEBAR_WIDTH}
                  preferredSize={
                    rightSidebarWidth ?? DEFAULT_RIGHT_SIDEBAR_WIDTH
                  }
                  priority={LayoutPriority.Low}
                  snap
                >
                  <ErrorBoundary label="Right sidebar">
                    <RightSidebar
                      views={sidebarViews}
                      openType={rightOpenType}
                      onSelectType={onRightSelectType}
                      args={{
                        windowId,
                        scopeId: activeScope?.id ?? null,
                        directory: activeScope?.directory ?? null,
                      }}
                    />
                  </ErrorBoundary>
                </Allotment.Pane>
              )}
            </Allotment>
          </Allotment.Pane>

          {/* Always mount the terminal pane and toggle via
              Allotment's own `visible` prop. Conditionally
              unmounting races with Allotment's first measurement
              pass: on the frame the pane appears it reads as 0px,
              `onVisibleChange(1, false)` fires, and our handler
              flips `terminalOpen` back off — "opens for one frame
              then snaps shut". */}
          <Allotment.Pane
            key="bottom-panel"
            visible={terminalOpen && activeBottomPanelView != null}
            minSize={SNAP_TERMINAL_HEIGHT}
            preferredSize={terminalHeight}
            priority={LayoutPriority.Low}
            snap
          >
            {activeBottomPanelView != null && (
              <ErrorBoundary label="Bottom panel">
                <BottomPanel
                  views={bottomPanelViews}
                  openType={activeBottomPanelView}
                  onSelectType={setBottomPanelView}
                  panelOpen={terminalOpen}
                  args={{
                    windowId,
                    scopeId: activeScope?.id ?? null,
                    directory: activeScope?.directory ?? null,
                    // Forward the collapsed/open state so embedded
                    // views can pause expensive work (e.g. ghostty's
                    // 60fps render loop) while the panel is hidden.
                    panelOpen: terminalOpen,
                  }}
                />
              </ErrorBoundary>
            )}
          </Allotment.Pane>
        </Allotment>
      </Allotment.Pane>
    </Allotment>
  )
}
