import { cn } from "@/lib/utils"
import type { LeftSidebarTab } from "@/lib/window-state/types"
import { useLeftSidebarViews } from "@/lib/sidebar-views"
import { SidebarTabTooltip } from "./sidebar-tab-tooltip"

export type LeftSidebarTabBarProps = {
  active: LeftSidebarTab
  onSelect: (tab: LeftSidebarTab) => void
}

/**
 * Left-sidebar tab strip. Renders one button per registered
 * left-sidebar view, in registration order. Every tab — chat
 * list included — is plugin-contributed: a view registered with
 * `meta.kind === "left-sidebar"` shows up here, and the host
 * routes the active tab through `<View type={tabId} />` (see
 * `workspace-shell/left-sidebar.tsx`).
 *
 * No built-in entries: adding or removing a tab is purely a
 * matter of installing or uninstalling the plugin that owns it.
 */
export function LeftSidebarTabBar({ active, onSelect }: LeftSidebarTabBarProps) {
  const tabs = useLeftSidebarViews()

  return (
    <div
      // 35px total = `ChatTabs` h-9 (36px) minus the 1px `border-t`
      // the surrounding `<Sidebar>` already draws for us. With our
      // own `border-b`, the bottom rule lands at the same y as the
      // per-tab inset shadow on the right pane's tab strip, so the
      // crease reads as one continuous line across the TitleBar
      // seam.
      //
      // `-mx-1.5 px-1.5` neutralises the `px-1.5` the
      // `<Sidebar header>` wrapper adds so our `border-b` spans the
      // sidebar's full inner width (otherwise the rule would inset
      // 6px on each side and look broken next to the chat strip's
      // full-width bottom rule).
      className="flex h-[35px] shrink-0 -mx-1.5 px-1.5 items-center justify-center gap-1 border-b"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      {tabs.map(tab => {
        const isActive = tab.type === active
        return (
          <SidebarTabTooltip
            key={tab.type}
            viewType={tab.type}
            kind="left"
            label={tab.label}
          >
            <button
              type="button"
              aria-label={tab.label}
              onClick={() => onSelect(tab.type)}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded",
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
            >
              {tab.iconSvg ? (
                <span
                  aria-hidden
                  className="flex h-4 w-4 items-center justify-center [&_svg]:h-4 [&_svg]:w-4"
                  dangerouslySetInnerHTML={{ __html: tab.iconSvg }}
                />
              ) : (
                // Fallback when a plugin tab ships no icon: render
                // the first letter so the button isn't a blank
                // square.
                <span className="text-[11px] font-semibold uppercase">
                  {tab.label.slice(0, 1)}
                </span>
              )}
            </button>
          </SidebarTabTooltip>
        )
      })}
    </div>
  )
}
