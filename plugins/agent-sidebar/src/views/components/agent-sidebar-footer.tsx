import { SidebarFooter } from "@/components/layout/sidebar-footer"
import { ChatSortMenu } from "./chat-sort-menu"
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
 *   - `ChatSortMenu`: choose the sort key for chat rows.
 *   - `WorktreeShelfMenu`: open the archived worktrees menu.
 *     Renders nothing until there's at least one archived
 *     worktree in the active workspace, so the footer stays a
 *     single-icon row on a fresh install.
 */
export function AgentSidebarFooter() {
  return (
    <SidebarFooter>
      <div className="flex w-full items-center justify-start gap-1">
        <ChatSortMenu />
        <WorktreeShelfMenu />
      </div>
    </SidebarFooter>
  )
}
