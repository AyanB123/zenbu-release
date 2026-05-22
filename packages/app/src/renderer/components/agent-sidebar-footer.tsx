import { SidebarFooter } from "./layout/sidebar-footer"
import { ChatSortMenu } from "./layout/chat-sort-menu"

/**
 * Footer for the agent tab of the left sidebar. Sits below the
 * scrollable chat list and provides the single sort/options icon.
 * The gradient fade above the footer is owned by `SidebarFooter`,
 * which paints a `--sidebar`-to-transparent gradient over the bottom
 * of the list so overflowing chat rows visually dissolve under the
 * footer chrome.
 *
 * For now this exposes one icon (sort options). Future affordances
 * (grouping, filters, etc.) should land here next to it so the
 * footer stays a stable home for list-shaping controls.
 */
export function AgentSidebarFooter() {
  return (
    <SidebarFooter>
      <div className="flex w-full items-center justify-start">
        <ChatSortMenu />
      </div>
    </SidebarFooter>
  )
}
