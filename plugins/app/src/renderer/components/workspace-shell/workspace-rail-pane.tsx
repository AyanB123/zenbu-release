import { View } from "@zenbujs/core/react"
import { WorkspaceRail } from "../layout/workspace-rail"
import { useActiveView, useActiveWorkspaceId, useWorkspaceRailOpen } from "@/lib/window-state/active-view"
import { useSidebarActions } from "../../hooks/use-sidebar-actions"
import { useWorkspaceContextMenu } from "../../hooks/use-workspace-context-menu"
import { useWorkspaceRailEntries } from "../../hooks/use-sidebar-selectors"
import { useWorkspaceRailViews } from "@/lib/sidebar-views"

/** Vertical workspace rail on the very left of the window.
 *
 * The rail's footer area is a plugin slot: every registered view
 * tagged `meta.kind === "workspace-rail"` is rendered here as a
 * `<View>`. The built-in settings gear comes in via the `settings`
 * plugin — there is no host-internal rail content anymore.
 */
export function WorkspaceRailPane() {
  const open = useWorkspaceRailOpen()
  if (!open) return null
  return <WorkspaceRailPaneBody />
}

function WorkspaceRailPaneBody() {
  const activeView = useActiveView()
  const activeWorkspaceId = useActiveWorkspaceId()
  const rail = useWorkspaceRailEntries()
  const actions = useSidebarActions()
  const contextMenus = useWorkspaceContextMenu()
  const railViews = useWorkspaceRailViews()

  return (
    <WorkspaceRail
      workspaces={rail}
      // `activeWorkspaceId` is null while onboarding is the active
      // view, so no tile lights up; `addActive` lights the "+" tile.
      activeId={activeWorkspaceId}
      addActive={activeView.kind === "onboarding"}
      onSelect={actions.handleSelectWorkspace}
      onAdd={actions.handleAddWorkspace}
      onContextMenu={(id, e) =>
        void contextMenus.handleWorkspaceContextMenu(id, e)
      }
      onBackgroundContextMenu={e =>
        void contextMenus.handleRailBackgroundContextMenu(e)
      }
      footer={
        railViews.length > 0 ? (
          <>
            {railViews.map(v => (
              <View
                key={v.type}
                type={v.type}
                args={{}}
                fallback={null}
              />
            ))}
          </>
        ) : null
      }
    />
  )
}
