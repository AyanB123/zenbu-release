import { cn } from "@/lib/utils"
import type { SidebarViewEntry } from "@/lib/sidebar-views"

export type RightSidebarTabBarProps = {
  views: SidebarViewEntry[]
  activeType: string
  onSelect: (type: string) => void
}

/**
 * Horizontal tab strip rendered at the top of the right sidebar body.
 * One row of icon buttons (one per registered view), styled to match
 * the left sidebar's tab bar so the two sides read as siblings.
 */
export function RightSidebarTabBar({
  views,
  activeType,
  onSelect,
}: RightSidebarTabBarProps) {
  return (
    <div
      // 35px = `ChatTabs` h-9 (36px) minus the 1px `border-t` the
      // surrounding `RightSidebarBody` already draws. With our own
      // `border-b`, the bottom rule lands at the same y as the
      // per-tab inset shadow on the chat strip and the left
      // sidebar's tab bar — one continuous crease across the
      // TitleBar seam. No negative margin needed here: the parent
      // doesn't add horizontal padding, so `border-b` already
      // spans the sidebar's full inner width.
      className="flex h-[35px] shrink-0 items-center justify-center gap-1 px-1 border-b"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      {views.map(view => {
        const isActive = view.type === activeType
        return (
          <button
            key={view.type}
            type="button"
            aria-label={view.label}
            onClick={() => onSelect(view.type)}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded",
              isActive
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
          >
            {view.iconSvg ? (
              <span
                aria-hidden
                className="inline-block size-[16px]"
                dangerouslySetInnerHTML={{ __html: scaleSvg(view.iconSvg) }}
              />
            ) : (
              <span className="text-[12px] font-medium uppercase">
                {view.label.charAt(0)}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

function scaleSvg(html: string): string {
  // Only strip width/height from the root <svg> tag — stripping them
  // globally would also remove them from inner elements like <rect>,
  // collapsing those shapes to 0×0 (which is what broke the
  // context-sidebar icon, since it's built entirely from <rect>s).
  return html.replace(/<svg\b[^>]*>/, (tag) => {
    const stripped = tag.replace(/\s(width|height)="[^"]*"/g, "")
    return stripped.replace(/<svg\b/, '<svg width="100%" height="100%"')
  })
}
