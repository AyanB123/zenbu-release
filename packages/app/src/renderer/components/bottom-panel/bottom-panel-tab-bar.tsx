import { cn } from "@/lib/utils"
import type { BottomPanelViewEntry } from "@/lib/bottom-panel-views"

export type BottomPanelTabBarProps = {
  views: BottomPanelViewEntry[]
  activeType: string
  onSelect: (type: string) => void
}

/**
 * Vertical icon strip rendered on the right edge of the bottom panel.
 * Mirrors the right sidebar's horizontal tab bar but stacks the icons
 * top-to-bottom because the bottom panel is wide and short. One
 * button per registered bottom-panel view.
 */
export function BottomPanelTabBar({
  views,
  activeType,
  onSelect,
}: BottomPanelTabBarProps) {
  return (
    <div
      className="flex h-full w-8 shrink-0 flex-col items-center gap-1 border-l bg-background py-1"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      {views.map(view => {
        const isActive = view.type === activeType
        return (
          <button
            key={view.type}
            type="button"
            title={view.label}
            aria-label={view.label}
            onClick={() => onSelect(view.type)}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded",
              isActive
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
          >
            {view.iconSvg ? (
              <span
                aria-hidden
                className="inline-block size-[14px]"
                dangerouslySetInnerHTML={{ __html: scaleSvg(view.iconSvg) }}
              />
            ) : (
              <span className="text-[11px] font-medium uppercase">
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
  // collapsing those shapes to 0×0.
  return html.replace(/<svg\b[^>]*>/, (tag) => {
    const stripped = tag.replace(/\s(width|height)="[^"]*"/g, "")
    return stripped.replace(/<svg\b/, '<svg width="100%" height="100%"')
  })
}
