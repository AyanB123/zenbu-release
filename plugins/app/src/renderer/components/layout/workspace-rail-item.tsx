import { Button } from "@zenbu/ui/button"
import { Spinner } from "../common/spinner"
import { WorkspaceIcon } from "./workspace-icon"
import { useWorkspaceIconUrl } from "@/lib/workspace-icon"
import type { Schema } from "../../../main/schema"

export type WorkspaceRailItemProps = {
  label: string
  icon?: Schema["workspaces"][string]["icon"]
  /** Auto-derived icon (set by `WorkspaceIconService` on workspace
   * creation / boot backfill). Resolved underneath `icon`. */
  iconAuto?: Schema["workspaces"][string]["iconAuto"]
  isActive: boolean
  hasActivity?: boolean
  onSelect: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  /** Hover handlers, owned by the rail. The rail renders a single
   * shared `<Popover>` whose anchor follows whichever item is
   * hovered — so transitioning between items just repositions one
   * popover instead of unmount/remounting per item (which is what
   * caused the fade-out / fade-in flicker users see with
   * per-item tooltips, even with `skipDelayDuration`). */
  onHoverEnter?: (el: HTMLElement) => void
  onHoverLeave?: () => void
  title?: string
}

export function WorkspaceRailItem({
  label,
  icon,
  iconAuto,
  isActive,
  hasActivity = false,
  onSelect,
  onContextMenu,
  onHoverEnter,
  onHoverLeave,
  title,
}: WorkspaceRailItemProps) {
  const iconUrl = useWorkspaceIconUrl({
    icon: icon ?? null,
    iconAuto: iconAuto ?? null,
  })
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onSelect}
      onContextMenu={onContextMenu}
      onMouseEnter={
        onHoverEnter ? e => onHoverEnter(e.currentTarget) : undefined
      }
      onMouseLeave={onHoverLeave}
      onFocus={onHoverEnter ? e => onHoverEnter(e.currentTarget) : undefined}
      onBlur={onHoverLeave}
      aria-label={title ?? label}
      className="relative h-9 w-9 p-0 hover:bg-transparent"
      style={{
        borderRadius: 8,
        background: isActive ? "var(--card)" : "transparent",
        boxShadow: isActive ? "0 1px 2px rgba(0, 0, 0, 0.06)" : "none",
      }}
    >
      <span
        aria-hidden
        className="absolute"
        style={{
          left: -6,
          top: 6,
          bottom: 6,
          width: 3,
          borderRadius: 2,
          background: isActive ? "var(--foreground)" : "transparent",
        }}
      />
      <WorkspaceIcon
        src={iconUrl}
        fallback={label}
        isActive={isActive}
      />
      {hasActivity && !isActive && (
        <span
          aria-hidden
          className="absolute text-muted-foreground"
          style={{ right: 2, top: 2 }}
        >
          <Spinner />
        </span>
      )}
    </Button>
  )
}
