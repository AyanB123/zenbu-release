import { useMemo, type ReactNode } from "react";
import { Allotment, LayoutPriority } from "allotment";
import { View } from "@zenbujs/core/react";
import { PaneFrame } from "../layout/pane-frame";
import { ErrorBoundary } from "../common/error-boundary";
import { EmptyWorkspaceScreen } from "../empty-workspace-screen";
import { useActiveView } from "@/lib/window-state/active-view";
import {
  useLeftSidebarOpen,
  useSetLeftSidebarOpen,
} from "@/lib/window-state/workspace-ui";
import {
  useBottomPanelOpen,
  useBottomPanelView,
  useSetBottomPanelOpen,
  useSetBottomPanelView,
  useSetRightSidebarOpenType,
} from "@/lib/window-state/scope-ui";
import {
  useSetWorkspaceLayout,
  useWorkspaceLayout,
} from "@/lib/window-state/layout";
import { useBottomPanelViews } from "@/lib/bottom-panel-views";
import {
  useRightSidebarToggle,
  DEFAULT_RIGHT_SIDEBAR_WIDTH,
  SNAP_RIGHT_SIDEBAR_WIDTH,
} from "../../hooks/use-right-sidebar-toggle";
import { useAgentSidebarLayout } from "../../hooks/use-agent-sidebar-layout";
import {
  useActiveScope,
  useHasAnyWorkspace,
} from "../../hooks/use-sidebar-selectors";
import { ChatsArea } from "./chats-area";
import { RightSidebar } from "./right-sidebar/right-sidebar";
import { BottomPanel } from "./bottom-panel/bottom-panel";
import { useWindowId } from "@/lib/window-state/window-id";
const DEFAULT_SIDEBAR_WIDTH = 220;
const SNAP_SIDEBAR_WIDTH = 160;
const DEFAULT_TERMINAL_HEIGHT = 260;
const SNAP_TERMINAL_HEIGHT = 80;

export type WorkspaceBodyProps = {
  sidebarSlot: ReactNode;
};

export function WorkspaceBody({ sidebarSlot }: WorkspaceBodyProps) {
  const activeView = useActiveView();
  const hasAnyWorkspace = useHasAnyWorkspace();

  if (activeView.kind === "view") {
    // settings/onboarding screen, when the workspace is not rendering
    return (
      <div className="absolute inset-0">
        <PaneFrame rightAdjacent className="overflow-hidden">
          <View
            name={activeView.viewType}
            args={cloneViewArgs(activeView.args)}
            className="size-full"
            fallback={
              <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground"></div>
            }
          />
        </PaneFrame>
      </div>
    );
  }

  const showOnboardingOverlay =
    !hasAnyWorkspace || activeView.kind === "onboarding";

  return (
    <div
      className="relative h-full w-full"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      <div
        className="absolute inset-0"
        style={
          showOnboardingOverlay
            ? ({
                visibility: "hidden",
                WebkitAppRegion: "no-drag",
              } as React.CSSProperties)
            : ({ WebkitAppRegion: "no-drag" } as React.CSSProperties)
        }
        aria-hidden={showOnboardingOverlay || undefined}
      >
        <WorkspaceBodyAllotments sidebarSlot={sidebarSlot} />
      </div>
      {showOnboardingOverlay && (
        <div
          className="absolute inset-0 bg-muted"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <EmptyWorkspaceScreen />
        </div>
      )}
    </div>
  );
}

function WorkspaceBodyAllotments({ sidebarSlot }: WorkspaceBodyProps) {
  const windowId = useWindowId();
  const sidebarOpen = useLeftSidebarOpen();
  const setSidebarOpen = useSetLeftSidebarOpen();
  const terminalOpen = useBottomPanelOpen();
  const setTerminalOpen = useSetBottomPanelOpen();
  const workspaceLayout = useWorkspaceLayout();
  const setWorkspaceLayout = useSetWorkspaceLayout();
  const sidebarWidth = workspaceLayout.sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH;
  const terminalHeight =
    workspaceLayout.terminalHeight ?? DEFAULT_TERMINAL_HEIGHT;

  const bottomPanelViews = useBottomPanelViews();
  const persistedBottomPanelView = useBottomPanelView();
  const setBottomPanelView = useSetBottomPanelView();
  const setRightOpenType = useSetRightSidebarOpenType();

  const activeScope = useActiveScope();

  const {
    sidebarViews,
    rightOpenType,
    rightSidebarWidth,
    isRightBodyOpen,
    onRightSelectType,
  } = useRightSidebarToggle();

  // Resolve the active bottom-panel view: persisted choice when
  // still registered, otherwise the first available.
  const activeBottomPanelView = useMemo(() => {
    if (
      persistedBottomPanelView &&
      bottomPanelViews.some((v) => v.type === persistedBottomPanelView)
    ) {
      return persistedBottomPanelView;
    }
    return bottomPanelViews[0]?.type ?? null;
  }, [bottomPanelViews, persistedBottomPanelView]);

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
  });

  return (
    <Allotment
      ref={outerAllotmentRef}
      className="app-shell-allotment"
      proportionalLayout={false}
      onChange={(sizes) => {
        outerTotalWidthRef.current = sizes.reduce((a, b) => a + b, 0);
      }}
      onDragEnd={(sizes) => {
        const [left] = sizes;
        if (sidebarOpen && left > 0) {
          setWorkspaceLayout({ sidebarWidth: left });
        }
      }}
      onVisibleChange={(index, visible) => {
        if (index === 0 && !visible) setSidebarOpen(false);
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
          onChange={(sizes) => {
            verticalTotalHeightRef.current = sizes.reduce((a, b) => a + b, 0);
          }}
          onDragEnd={(sizes) => {
            const bottom = sizes[1];
            if (terminalOpen && bottom != null && bottom > 0) {
              setWorkspaceLayout({ terminalHeight: bottom });
            }
          }}
          onVisibleChange={(index, visible) => {
            if (index === 1 && !visible) setTerminalOpen(false);
          }}
        >
          <Allotment.Pane priority={LayoutPriority.High}>
            <Allotment
              ref={innerAllotmentRef}
              proportionalLayout={false}
              onChange={(sizes) => {
                innerTotalWidthRef.current = sizes.reduce((a, b) => a + b, 0);
              }}
              onDragEnd={(sizes) => {
                const right = sizes[1];
                if (isRightBodyOpen && right != null && right > 0) {
                  setWorkspaceLayout({ rightSidebarWidth: right });
                }
              }}
              onVisibleChange={(index, visible) => {
                if (index === 1 && !visible) setRightOpenType(null);
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
                  onClose={() => setTerminalOpen(false)}
                  args={{
                    windowId,
                    scopeId: activeScope?.id ?? null,
                    directory: activeScope?.directory ?? null,
                    panelOpen: terminalOpen,
                  }}
                />
              </ErrorBoundary>
            )}
          </Allotment.Pane>
        </Allotment>
      </Allotment.Pane>
    </Allotment>
  );
}

function cloneViewArgs(
  args: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!args) return {};
  try {
    return JSON.parse(JSON.stringify(args)) as Record<string, unknown>;
  } catch (err) {
    console.warn("[workspace-body] view args not serializable:", err);
    return {};
  }
}
