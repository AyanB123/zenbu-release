import { SidebarFooter } from "@/components/layout/sidebar-footer"
import { WorktreeShelfMenu } from "./worktree-shelf-menu"

/**
 * Footer for the agent tab of the left sidebar. Sits below the
 * scrollable chat list and hosts list-shaping controls.
 * The gradient fade above the footer is owned by `SidebarFooter`,
 * which paints a `--sidebar`-to-transparent gradient over the bottom
 * of the list so overflowing chat rows visually dissolve under the
 * footer chrome.
 *
 * Slots:
 *   - `WorktreeShelfMenu`: open the archived items menu (work
 *     trees + chats). Renders nothing until there's at least one
 *     archived item in the active workspace, so the footer stays
 *     empty on a fresh install.
 */
export function AgentSidebarFooter() {
  return (
    <SidebarFooter>
      <div className="flex w-full items-center justify-start gap-1">
        <WorktreeShelfMenu />
      </div>
    </SidebarFooter>
  )
}
