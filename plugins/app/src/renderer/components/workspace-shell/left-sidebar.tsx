import { View } from "@zenbujs/core/react"
import { Sidebar } from "../layout/sidebar"
import { LeftSidebarTabBar } from "../layout/left-sidebar-tab-bar"
import { ErrorBoundary } from "../common/error-boundary"
import { useWorkspaceRailOpen } from "@/lib/window-state/active-view"
import {
  useLeftSidebarTab,
  useSetLeftSidebarTab,
} from "@/lib/window-state/workspace-ui"
import { useActiveScopeId } from "@/lib/window-state/active-view"

/**
 * Host chrome for the left sidebar. Renders the cross-tab tab bar
 * and routes the active tab to its registered view via `<View>`.
 *
 * Every left-sidebar tab is a plugin-contributed
 * `rendering: "component"` view tagged
 * `meta.kind = "left-sidebar"`:
 *
 *  - `"agent"` (chat list)  \u2014 `plugins/agent-sidebar`
 *  - `"extra-dirs"`         \u2014 `plugins/extra-dirs-sidebar`
 *
 * The `LeftSidebarTabBar` derives its tab list from the registry
 * via `useLeftSidebarViews()`, so adding a new tab is purely a
 * matter of registering a new view \u2014 no host changes required.
 *
 * The plugin view fills the body edge-to-edge
 * (`bodyVariant="fill"`) and owns its own internal layout (header
 * buttons, scroll area, footer overlay).
 */
export function LeftSidebar() {
  const workspaceRailOpen = useWorkspaceRailOpen()
  const leftSidebarTab = useLeftSidebarTab()
  const setLeftSidebarTab = useSetLeftSidebarTab()
  const activeScopeId = useActiveScopeId()

  return (
    <div className="flex h-full overflow-hidden text-[13px]">
      <ErrorBoundary label="Left sidebar">
        <Sidebar
          flushLeft={!workspaceRailOpen}
          bodyVariant="fill"
          header={
            <LeftSidebarTabBar
              active={leftSidebarTab}
              onSelect={setLeftSidebarTab}
            />
          }
        >
          <View
            type={leftSidebarTab}
            args={{ scopeId: activeScopeId }}
            className="size-full"
            fallback={
              <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">
                Loading…
              </div>
            }
          />
        </Sidebar>
      </ErrorBoundary>
    </div>
  )
}
