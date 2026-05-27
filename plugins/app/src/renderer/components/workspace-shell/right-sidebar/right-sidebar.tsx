import { useEffect, useMemo, useState } from "react"
import { PluginSidebarView } from "./plugin-sidebar-view"
import { RightSidebarTabBar } from "./right-sidebar-tab-bar"
import type { SidebarViewEntry } from "@/lib/sidebar-views"

export type RightSidebarProps = {
  views: SidebarViewEntry[]
  /** The currently open view type. Caller guarantees this is non-null. */
  openType: string
  onSelectType: (type: string) => void
  /** Args every embedded sidebar view receives. Mirrors the bottom
   * panel: forwarded into the iframe via `?args=` and updates so
   * child views (e.g. the git client) always know the current
   * window's scope directory. */
  args: Record<string, unknown>
}

/**
 * Body for the right sidebar. Renders a horizontal tab strip at the
 * top (one icon per registered view, mirroring the left sidebar's
 * tab bar) and keeps a "visited" set so previously opened views stay
 * mounted (hidden) when the user switches between them.
 *
 * Layout/edges (think VS Code's right side):
 *
 *  - Right edge sits flush against the app shell's rounded right border,
 *    so we draw NO `border-r` and NO `rounded-tr-lg` — the outer
 *    `WorkspaceShell` already provides both (its `border` +
 *    `rounded-[10px]` + `overflow-hidden`).
 *  - Bottom edge is always adjacent to either the outer shell's
 *    bottom border or the terminal pane (via an Allotment separator),
 *    so we draw NO `border-b` either.
 *  - Left edge is always adjacent to the chat host via an Allotment
 *    separator, so we draw NO `border-l`.
 *  - Top edge has the title bar above it, which doesn't draw a
 *    `border-b`. We supply the seam with our own `border-t`.
 *
 * Width / visibility of this whole panel is managed by the parent
 * layout (an Allotment.Pane).
 */
export function RightSidebar({
  views,
  openType,
  onSelectType,
  args,
}: RightSidebarProps) {
  const [visited, setVisited] = useState<Set<string>>(() => new Set([openType]))

  useEffect(() => {
    setVisited(prev => {
      if (prev.has(openType)) return prev
      const next = new Set(prev)
      next.add(openType)
      return next
    })
  }, [openType])

  const visibleViews = useMemo(
    () => views.filter(v => visited.has(v.type)),
    [views, visited],
  )

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden border-t bg-background text-foreground">
      <RightSidebarTabBar
        views={views}
        activeType={openType}
        onSelect={onSelectType}
      />
      <div className="relative min-h-0 min-w-0 flex-1">
        {visibleViews.map(view => (
          <div
            key={view.type}
            className="absolute inset-0"
            style={{ display: view.type === openType ? "block" : "none" }}
          >
            <PluginSidebarView viewType={view.type} args={args} />
          </div>
        ))}
      </div>
    </div>
  )
}
