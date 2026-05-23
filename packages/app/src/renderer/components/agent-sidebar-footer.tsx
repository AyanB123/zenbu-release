import { SidebarFooter } from "./layout/sidebar-footer"
import { ChatSortMenu } from "./layout/chat-sort-menu"
import { WorktreeShelfMenu } from "./layout/worktree-shelf-menu"

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
 *   - `WorktreeShelfMenu`: open the archived / completed worktree
 *     buckets. Renders nothing until there's at least one shelved
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
